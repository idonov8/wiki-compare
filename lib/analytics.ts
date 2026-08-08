import type { PostHog } from "posthog-js";

/**
 * Product analytics, on both sides of the wire.
 *
 * Nothing in the app may depend on this being configured or reachable. With no
 * key set every function here is a silent no-op, and with a key set every call
 * still swallows its own failures — the same principle as `/api/recent`, which
 * answers with an empty list rather than failing the caller, because a page that
 * breaks when the telemetry breaks is a page that has its priorities backwards.
 *
 * `donate_attempted` is the event this whole exercise exists to produce. It
 * counts the people who tried to give money to something that could not take it,
 * which is the only number that says whether any of this was worth building.
 */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

/** Every event we send. A const rather than bare strings so a call site that
 *  mistypes one fails to compile instead of quietly landing in no funnel. */
export const EVENTS = [
  /** A comparison was opened, from search, a link or the recent list. */
  "article_opened",
  /** The reader reached the end of the funded preview and saw the gate. */
  "preview_gate_shown",
  "gate_cta_clicked",
  /** The badge on a comparison older than Wikipedia's current text. */
  "stale_update_clicked",
  "login_requested",
  "login_completed",
  /** The reader signed out from the masthead. */
  "logout_clicked",
  "donate_page_viewed",
  /** The one that matters: somebody tried to pay. */
  "donate_attempted",
  "mock_grant_issued",
  /** A code was submitted, and what came of it. Together they say whether a
   *  code is reaching people or only collecting typos. */
  "coupon_submitted",
  "coupon_redeemed",
  "coupon_rejected",
  /** Credits deducted for a full read. */
  "credits_spent",
  /** A comparison was served, cached or freshly run. */
  "comparison_served",
] as const;

export type AnalyticsEvent = (typeof EVENTS)[number];

export type EventProperties = Record<string, unknown>;

/** Whether a key is set at all. Exported so a caller can skip assembling
 *  properties it would only throw away. */
export function analyticsEnabled(): boolean {
  return !!KEY;
}

/* ---- server ---- */

/**
 * Send one event from a route handler.
 *
 * Posts straight to PostHog's capture endpoint rather than pulling in
 * `posthog-node`: it is one JSON body, and a dependency that buffers events in a
 * process the platform may freeze between requests would need flushing at every
 * exit anyway.
 *
 * Returns void, and deliberately not a promise: awaiting a telemetry POST would
 * put PostHog's latency in front of the reader's response. The request is fired
 * and abandoned, with every failure — network, DNS, a 500, an abort at the end
 * of the invocation — caught and dropped.
 */
export function capture(
  event: AnalyticsEvent,
  properties: EventProperties = {},
  distinctId?: string,
): void {
  if (!KEY) return;
  try {
    void fetch(`${HOST}/i/v0/e/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: KEY,
        event,
        // PostHog requires a distinct id. Events with no account behind them
        // are attributed to the server itself rather than being dropped: the
        // count is the point, and inventing a per-request id would inflate the
        // user total with one "person" per anonymous comparison.
        distinct_id: distinctId ?? "server",
        properties: { ...properties, $lib: "wiki-compare-server" },
        timestamp: new Date().toISOString(),
      }),
      // Lets the platform post this after the response has been returned.
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Unreachable in practice — fetch rejects rather than throws — but this
    // function's contract is that it never throws, so it never throws.
  }
}

/* ---- client ---- */

let client: PostHog | null = null;
let starting = false;

/** Events raised before the library finished loading. Bounded: if the import
 *  never lands, this is a leak that grows for as long as the tab is open. */
const queued: Array<[AnalyticsEvent, EventProperties]> = [];
const QUEUE_LIMIT = 20;

/** An account named before the library was ready, applied once it is. */
let pendingId: [string, EventProperties] | null = null;

/**
 * Load and initialise posthog-js, at most once per page.
 *
 * The import is dynamic so that `capture` above can be called from a route
 * handler without a browser bundle being dragged into the server graph.
 */
export function initAnalytics(): void {
  if (!KEY || starting || typeof window === "undefined") return;
  starting = true;
  void import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(KEY, {
        api_host: HOST,
        // We send `article_opened` ourselves with the subject attached, which is
        // the pageview worth having; the automatic one would double every row.
        capture_pageview: false,
      });
      client = posthog;
      // Identity first, so the events waiting behind it land on the account
      // rather than on the anonymous id they were raised under.
      if (pendingId) {
        try {
          posthog.identify(pendingId[0], pendingId[1]);
        } catch {}
        pendingId = null;
      }
      for (const [event, properties] of queued.splice(0)) {
        try {
          posthog.capture(event, properties);
        } catch {}
      }
    })
    .catch(() => {
      // Blocked by an ad blocker, offline, or the chunk failed to load. The
      // queue is dropped and `track` stays a no-op for the rest of the page.
      starting = false;
      queued.length = 0;
      pendingId = null;
    });
}

/** Send one event from the browser. Safe to call before `initAnalytics` and
 *  safe to call when analytics is off; either way it cannot throw. */
export function track(event: AnalyticsEvent, properties: EventProperties = {}): void {
  if (!KEY || typeof window === "undefined") return;
  try {
    if (client) {
      client.capture(event, properties);
      return;
    }
    initAnalytics();
    if (queued.length < QUEUE_LIMIT) queued.push([event, properties]);
  } catch {}
}

/**
 * Attach the browser's events to an account, so the sign-in that a donation
 * needed and the donation itself are one person rather than two.
 */
export function identify(distinctId: string, properties: EventProperties = {}): void {
  if (!KEY || typeof window === "undefined") return;
  try {
    if (!client) {
      pendingId = [distinctId, properties];
      initAnalytics();
      return;
    }
    client.identify(distinctId, properties);
  } catch {}
}
