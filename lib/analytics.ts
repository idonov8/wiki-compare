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
 * The browser half runs cookieless and profileless on purpose, which is what
 * keeps a consent banner off the front of a reading site. The constraint that
 * falls out of it: everything here has to be answerable in aggregate, because
 * there is no per-reader record to go back to and no way to ask a follow-up
 * question of one visit.
 */

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

/** Every event we send. A const rather than bare strings so a call site that
 *  mistypes one fails to compile instead of quietly landing in no funnel. */
export const EVENTS = [
  /** A comparison was opened, from search, a link or the recent list. */
  "article_opened",
  /** The footer's Donate link, to Ko-fi, was followed. */
  "donate_clicked",
  /** A link to the source on GitHub was followed, from the footer or the
   *  masthead (`surface`). */
  "source_clicked",
  /** Someone joined, or left, the list for project updates. */
  "updates_subscribed",
  "updates_unsubscribed",
  /** A comparison was served, cached or freshly run. */
  "comparison_served",
  /** The language stamp on the search field was opened. Until it can offer a
   *  choice, this counts the demand for one. */
  "language_menu_opened",
  /** The feedback form was opened from a named surface. */
  "feedback_opened",
  /** The reader scrolled far enough to reach the sources panel and it loaded.
   *  How many people read that far is the first thing worth knowing about an
   *  appendix. */
  "sources_viewed",
  /** One version's blindspots were highlighted in the others' lists — the
   *  question the panel is really for, and the only one it has to be asked. */
  "sources_blindspots_highlighted",
  /** The "Jump to sources" shortcut beside the diff stepper was pressed. */
  "sources_shortcut_clicked",
  /** A comparison was run on the Jev engine, with what it found and cost. */
  "jev_comparison_run",
  /** A claim's generated explanation was served, freshly written or stored. */
  "explanation_served",
  /** The panel showing a sentence's counterparts stayed open long enough to be
   *  read, on hover or pinned by a click. */
  "counterpart_viewed",
  /** The reader switched between the differences that matter and all of them. */
  "show_all_toggled",
  "selection_echoed",
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
export function capture(event: AnalyticsEvent, properties: EventProperties = {}): void {
  if (!KEY) return;
  try {
    void fetch(`${HOST}/i/v0/e/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        api_key: KEY,
        event,
        // PostHog requires a distinct id. Events are attributed to the server
        // itself: the count is the point, and inventing a per-request id would
        // inflate the user total with one "person" per anonymous comparison.
        distinct_id: "server",
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
        /**
         * Everything below this line is what lets the site run without a cookie
         * banner, and none of it is a default — posthog-js out of the box sets a
         * year-long cookie, autocaptures every click, and leaves replay to a
         * server-side switch.
         *
         * Cookieless mode stores nothing on the device at all: no cookie, no
         * localStorage, no sessionStorage. PostHog counts visitors with a hash
         * of (project, daily salt, IP, user agent, host) computed on their
         * servers, and the salt is discarded daily, so there is no identifier
         * here to consent to.
         *
         * This one is not self-enforcing: cookieless mode must also be switched
         * on in the PostHog project settings, or every event sent this way is
         * dropped at ingestion.
         */
        cookieless_mode: "always",
        /**
         * No person profiles, ever. A profile is the durable record of one
         * reader, and the reading list this site would attach to it — which
         * subjects, in which language — is close enough to political opinion to
         * be data of special sensitivity under Amendment 13. The event counts
         * are what the funnels need; the person behind them is not.
         */
        person_profiles: "never",
        /**
         * Autocapture is the sharpest edge here, because what it records is the
         * text of whatever was clicked, and on this site that text is Wikipedia
         * prose about the conflict. Our own named events say everything the
         * funnels need without shipping the page's own words to a third party.
         */
        autocapture: false,
        /**
         * Off here as well as in the project settings. Replay of these pages is
         * a recording of somebody reading about a war, and the belt-and-braces
         * is deliberate: left at its default this is a checkbox in a dashboard
         * away from being on, with nothing in the repo to say it changed.
         */
        disable_session_recording: true,
      });
      client = posthog;
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
