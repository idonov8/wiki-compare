"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ArticlesSkeleton from "./ArticlesSkeleton";
import Columns from "./Columns";
import { comparePath } from "./Highlighted";
import CreditBar from "./CreditBar";
import DiffNav from "./DiffNav";
import Footer from "./Footer";
import Landing from "./landing/Landing";
import LangBars from "./LangBars";
import LangSwitch from "./LangSwitch";
import Legend from "./Legend";
import Loading from "./Loading";
import PreviewGate from "./PreviewGate";
import SearchBox from "./SearchBox";
import { useNarrow } from "./useNarrow";
import { useSwipe } from "./useSwipe";
import Wordmark from "./Wordmark";
import { initAnalytics, track } from "@/lib/analytics";
import { formatCost, storedCost } from "@/lib/pricing";
import { readNdjson } from "@/lib/ndjson";
import {
  CACHE_WINDOW_DAYS,
  LANGS,
  LANG_META,
  type ArticleSnapshot,
  type CacheInfo,
  type Claim,
  type CompareEvent,
  type ComparePayload,
  type Lang,
  type MeResponse,
  type RecentArticle,
} from "@/lib/types";

const asLang = (value: string | null): Lang =>
  value && (LANGS as readonly string[]).includes(value) ? (value as Lang) : "en";

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 hours ago" / "in 2 days", at the coarsest unit that still says something. */
function relative(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const [unit, size]: [Intl.RelativeTimeFormatUnit, number] =
    abs < 3_600_000 ? ["minute", 60_000] : abs < 86_400_000 ? ["hour", 3_600_000] : ["day", 86_400_000];
  return RELATIVE.format(Math.round(ms / size), unit);
}

/** What the `cached` badge says when it opens: which versions moved, and the
 *  offer to replace this answer with one read from the live text. */
function cacheNote(cache: CacheInfo): string {
  const names = cache.edited.map((l) => LANG_META[l].label);
  const subject =
    names.length === 1
      ? `The ${names[0]} article has`
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} have`;
  return (
    `${subject} been edited on Wikipedia since this comparison was processed ${relative(cache.computedAt)}. ` +
    `Donate to update this page.`
  );
}

/**
 * What this comparison cost somebody, in the meta strip.
 *
 * A cache hit is not free and must never say so. Somebody paid to have this
 * article read, and everyone arriving after them reads it for nothing — that
 * exchange is the whole argument this site makes for donating, and printing
 * "free" at the end of it threw the argument away.
 *
 * Most stored comparisons predate costs being recorded, so most of the time the
 * figure is `storedCost`'s estimate from the token totals rather than the price
 * struck on the day. That is worth saying and worth marking: "about $0.18" reads
 * as an estimate on sight, without a legend and without a reader having to know
 * that a stored row can be missing a field. The title attribute carries why, and
 * that the estimate errs high. Only a run with no usable totals at all says
 * nothing — there, any number would be invented.
 */
function costNote(data: ComparePayload): string | null {
  const cost = storedCost(data.usage);
  const amount = cost
    ? cost.approximate
      ? // "about <$0.01" is nonsense; under a cent, the bound is the estimate.
        cost.usd < 0.01
        ? "under $0.01"
        : `about ${formatCost(cost.usd)}`
      : formatCost(cost.usd)
    : null;
  // A preview is the one case where the scope matters more than the money: it
  // says what it is first, because the columns below it fade out.
  if (data.scope?.kind === "preview") return amount ? `preview · ${amount}` : "preview";
  if (!amount) return null;
  return data.fromCache
    ? `${amount} was paid to process this article`
    : `${amount} to process this article`;
}

/** The token breakdown, which stays in the title attribute: two numbers nobody
 *  can price without a rate card do not belong in the strip itself. An estimated
 *  figure explains itself here too — an approximation a reader cannot check the
 *  provenance of is only a guess with a decimal point. */
function tokenNote(data: ComparePayload): string {
  const counts =
    `${data.usage.inputTokens.toLocaleString()} tokens in, ` +
    `${data.usage.outputTokens.toLocaleString()} out`;
  const when = data.fromCache ? `${counts}, on the run that processed this article` : counts;
  return storedCost(data.usage)?.approximate
    ? `${when}. This run predates the per-model breakdown, so its tokens are ` +
        `priced at the more expensive of the two models it used: the figure is ` +
        `an upper bound on what was actually paid.`
    : when;
}

const KIND_LABEL: Record<Claim["type"], string> = {
  contradiction: "Contradiction",
  unique: "Only in one version",
  framing: "Different framing",
};

interface CardState {
  claim: Claim;
  left: number;
  /** Exactly one of these is set: `bottom` anchors the card above the mark. */
  top?: number;
  bottom?: number;
}

interface Hit {
  lang: string;
  title: string;
  description?: string;
  url: string;
}

/** The card's widest, which it takes unless the viewport is narrower. */
const CARD_WIDTH = 340;
const CARD_MARGIN = 8;
/** Enough room to place the card below a mark without it running off-screen. */
const CARD_CLEARANCE = 190;
// Disabled for now — see the "coverage panel jump" block below `toggle` and the
// coverage section further down for the rest of this feature.
// /** Room left above a mark scrolled to from the coverage panel, so it isn't
//  *  flush against the viewport edge. Same clearance DiffNav's jump-to uses. */
// const SCROLL_CLEARANCE = 96;

/** How far the incoming column slides in from when the language changes. Enough
 *  to read as the article having moved sideways, not as a new page. */
const SLIDE_PX = 26;

/**
 * A comparison costs tokens and about a minute, and every second of it is
 * wasted if the subject was wrong — so the article is chosen from search
 * results rather than guessed from the box. The choice starts the comparison
 * immediately, and the article itself is what fills the wait: it is fetched in
 * parallel and on screen within a second, so the reader can see they picked the
 * right page while the model is still reading it.
 */
type Phase = "idle" | "results" | "comparing" | "done";

export default function Compare() {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [target, setTarget] = useState<Hit | null>(null);
  const [articles, setArticles] = useState<Record<string, ArticleSnapshot>>({});
  const [data, setData] = useState<ComparePayload | null>(null);
  /** Differences that have arrived so far on a run still in progress. The model
   *  writes them one at a time and each is independently displayable, so they go
   *  on the page as they land rather than a minute later all at once. `data`
   *  supersedes this the moment the run finishes — same claims, but with the
   *  usage and scope that only the finished run knows. */
  const [liveClaims, setLiveClaims] = useState<Claim[]>([]);
  const [shown, setShown] = useState<Lang[]>([...LANGS]);
  /** The one language on screen where three columns do not fit. Kept apart from
   *  `shown` rather than folded into it: the two are different questions — which
   *  editions to set beside each other, and which one to be reading — and a
   *  phone rotated into landscape should find the desktop answer where it left
   *  it. */
  const [active, setActive] = useState<Lang>("en");
  /** Which way the last language change moved, so the incoming column enters
   *  from the side the reader pulled it in from. */
  const [enterFrom, setEnterFrom] = useState(0);
  const [card, setCard] = useState<CardState | null>(null);
  // /** A coverage pill just clicked: which language's column to jump to, and
  //  *  which concept's mark to land on there. Cleared once the jump has run, or
  //  *  once it's given up looking — see the effect below. */
  // const [pendingLink, setPendingLink] = useState<{ lang: Lang; qid: string } | null>(null);
  const [recent, setRecent] = useState<RecentArticle[]>([]);
  /** True until the first `/api/recent` response lands, so the ledger can
   *  show a skeleton instead of popping in from nothing once it does. Never
   *  reset back to true on later refetches — a returning visitor still has
   *  the last list on screen, and re-skeletoning it would just trade one
   *  jump for another. */
  const [recentLoading, setRecentLoading] = useState(true);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [funding, setFunding] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);
  /** Set once the landing page's own search field has scrolled out of reach.
   *  While it is on screen the masthead carries no search at all — two boxes
   *  visible at once is just the same control asked for twice. */
  const [docked, setDocked] = useState(false);

  const reset = () => {
    setError(null);
    setCard(null);
    setFundError(null);
  };

  const refreshMe = useCallback(() => {
    fetch("/api/me")
      .then((res) => res.json())
      .then((json) => setMe(json))
      .catch(() => {});
  }, []);

  useEffect(() => {
    initAnalytics();
    refreshMe();
  }, [refreshMe]);

  /** The querystring we last acted on, so a pushState of our own doesn't
   *  look like a navigation to re-apply. */
  const appliedUrl = useRef<string | null>(null);

  /** Bumped at the top of every `open`. A streaming read outlives the article
   *  it was started for — following a link or pressing back begins another one
   *  while the first is still arriving — so each read stamps its id here and
   *  ignores any event once a later read has taken over. Without this the stale
   *  run's claims blend into the new page and its `done` line replaces it. */
  const runId = useRef(0);

  /**
   * Open an article: one streaming request that reports as it goes.
   *
   * This used to be two requests — `/api/articles` for the columns and
   * `/api/compare` for the marks — on the theory that the second would find the
   * article cache the first had warmed. It did not: nothing dedupes them, so on
   * a cold article both fetched all three editions from Wikipedia and both ran
   * the link-to-Wikidata resolution, doubling the work and the rate-limit
   * exposure to save nothing. The stream sends the articles on the same line
   * budget as the old separate call, and then the differences as they are found.
   */
  const open = useCallback(async (hit: Hit) => {
    // This read supersedes any still arriving from an article the reader has
    // moved on from. Every state write below is gated on the id still being
    // current, so a stale stream's claims and `done` line land on the floor.
    const id = ++runId.current;
    const current = () => runId.current === id;

    reset();
    setTarget(hit);
    setArticles({});
    setData(null);
    setLiveClaims([]);
    setPhase("comparing");

    const showArticles = (articles: Record<string, ArticleSnapshot> | undefined) => {
      if (!articles) return;
      setArticles(articles);
      setShown(LANGS.filter((l) => articles[l]));
    };

    try {
      const res = await fetch(
        `/api/compare?title=${encodeURIComponent(hit.title)}&lang=${encodeURIComponent(hit.lang)}&stream=1`,
      );
      // A failure before the first line is still an ordinary JSON error body.
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? "Comparison failed.");
      }

      let final: ComparePayload | null = null;
      let failed: string | null = null;

      await readNdjson<CompareEvent>(res.body, (event) => {
        if (!current()) return;
        switch (event.event) {
          case "articles":
            showArticles(event.articles);
            break;
          case "claim":
            setLiveClaims((claims) => [...claims, event.claim]);
            break;
          case "done":
            final = { ...event.result, fromCache: event.fromCache, cache: event.cache };
            break;
          case "error":
            failed = event.error;
            break;
        }
      });

      if (!current()) return;
      if (failed) throw new Error(failed);
      if (!final) throw new Error("The comparison ended without returning a result.");

      setData(final);
      showArticles((final as ComparePayload).articles);
      setPhase("done");
    } catch (e) {
      if (!current()) return;
      setError(e instanceof Error ? e.message : "Comparison failed.");
      setPhase(hits.length ? "results" : "idle");
    }
  }, [hits.length]);

  // The open article lives in the URL, so a comparison is linkable and the back
  // button works. A ref keeps the popstate listener from being torn down and
  // re-run — re-running it would refetch the article on every state change.
  const openRef = useRef(open);
  openRef.current = open;

  const navigate = useCallback((title: string, lang: string) => {
    const t = title.trim();
    if (!t) return;
    setQuery(t);
    setHits([]);
    window.history.pushState(null, "", comparePath(t, lang));
    appliedUrl.current = window.location.search;
    window.scrollTo({ top: 0 });
    void openRef.current({ lang, title: t, url: "" });
  }, []);

  useEffect(() => {
    const apply = () => {
      if (window.location.search === appliedUrl.current) return;
      appliedUrl.current = window.location.search;
      const params = new URLSearchParams(window.location.search);
      const title = params.get("title");
      if (!title) {
        setPhase("idle");
        setArticles({});
        setData(null);
        setError(null);
        return;
      }
      setQuery(title);
      setHits([]);
      void openRef.current({ lang: asLang(params.get("lang")), title, url: "" });
    };
    apply();
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, []);

  // Refreshed on every return to the landing state, so an article compared and
  // then backed out of is at the top of the list waiting. Reading the URL rather
  // than trusting the phase alone keeps a deep link from spending a request on a
  // list it will never show: `idle` is also the phase of the first render before
  // the effect above has opened the article named in the querystring.
  useEffect(() => {
    if (phase !== "idle" || new URLSearchParams(window.location.search).get("title")) return;
    const abort = new AbortController();
    fetch("/api/recent", { signal: abort.signal })
      .then((res) => res.json())
      .then((json) => {
        setRecent(json.items ?? []);
        setRecentLoading(false);
      })
      // Not a `.finally`: an aborted request (StrictMode's mount-cleanup-mount
      // in dev, or a phase change mid-flight) lands here too, and clearing
      // the skeleton on the abort would drop back to nothing while the
      // effect's real re-fetch is still in flight — the same pop-in this
      // skeleton exists to avoid.
      .catch(() => {
        if (!abort.signal.aborted) setRecentLoading(false);
      });
    return () => abort.abort();
  }, [phase]);

  const search = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    // The fixture route is a rendering harness, not a subject: it has no search
    // results to pick from, so it is opened directly.
    if (q.startsWith("demo:")) {
      navigate(q, "en");
      return;
    }

    reset();
    setBusy(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Search failed.");
      const results = (json.results ?? []) as Hit[];
      if (!results.length) throw new Error(`Nothing on Wikipedia matches “${q}”.`);
      setHits(results);
      // A pasted URL names one article, so there is nothing to pick between.
      if (json.exact) navigate(results[0].title, results[0].lang);
      else setPhase("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
      setPhase("idle");
    } finally {
      setBusy(false);
    }
  }, [query, navigate]);

  const available = useMemo(
    () => LANGS.filter((l) => articles[l]),
    [articles],
  );
  // /** The coverage panel, one column per edition that has anything to show —
  //  *  an edition with nothing unique to it drops out rather than sitting there
  //  *  empty. A gap present in two editions appears in both their columns, once
  //  *  each, since each occurrence is a different span to jump to. */
  // const coverageColumns = useMemo(
  //   () =>
  //     available
  //       .map((lang) => ({ lang, gaps: (data?.coverage ?? []).filter((g) => g.presentIn.includes(lang)) }))
  //       .filter((col) => col.gaps.length > 0),
  //   [available, data?.coverage],
  // );
  const narrow = useNarrow();
  /** The language being read on a narrow screen. `active` survives opening
   *  another article — following a link out of the Arabic column should land in
   *  Arabic — so it can name an edition this subject doesn't have, and the first
   *  one it does have is the fallback. */
  const solo = available.includes(active) ? active : available[0];
  const visible = narrow ? (solo ? [solo] : []) : shown.filter((l) => available.includes(l));
  const badged = !!data?.cache && data.cache.edited.length > 0;
  // While a fund is streaming, `data` still describes the preview that is being
  // replaced — the gate has to drop the instant the button is pressed, not once
  // the reply says the scope changed, so `funding` overrides it here too.
  const preview = data?.scope?.kind === "preview" && !funding;
  /** What is marked on the page right now: the finished run's claims, or the
   *  ones that have arrived so far while it is still reading — whether that
   *  reading is the free preview or the fund that is replacing it. The
   *  finished run supersedes rather than merges — it is the same list, and it
   *  is the copy that got stored. */
  const claims = funding ? liveClaims : (data?.claims ?? liveClaims);

  const goDonate = useCallback((from: string) => {
    void track("gate_cta_clicked", { from });
    window.location.href = `/donate?from=${encodeURIComponent(from)}`;
  }, []);

  /**
   * Buy the rest of this article, or a re-read of one whose revisions have moved
   * on. Streamed for the same reason `open` is: the gate's job is done the
   * instant the request goes out — the reader paid, the rest of the article is
   * already sitting in `articles`, there is nothing left to gate — so it drops
   * immediately rather than waiting out the minute-long read behind "Reading
   * the rest…". What was behind it streams in its own marks exactly as `open`
   * does, `liveClaims` doing double duty as whichever run is currently arriving.
   * The reply's `done` line still replaces `data` wholesale at the end, which is
   * what turns `preview` false for good and lets `liveClaims` step aside for the
   * stored claim list.
   */
  const fund = useCallback(
    async (kind: "full" | "refresh") => {
      if (!target || funding) return;
      // Shares `runId` with `open`: following a link away from this article
      // while its purchase is still streaming must not have the late claims or
      // the late `done` land on whatever is on screen by then.
      const id = ++runId.current;
      const current = () => runId.current === id;

      setFunding(true);
      setFundError(null);
      setLiveClaims([]);
      void track(kind === "refresh" ? "stale_update_clicked" : "gate_cta_clicked", {
        qid: data?.qid,
        from: "fund",
      });
      try {
        const res = await fetch("/api/compare?stream=1", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: target.title, lang: target.lang, kind }),
        });
        if (!res.ok || !res.body) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json.error ?? "That didn't work.");
        }

        let final: ComparePayload | null = null;
        let failed: string | null = null;

        await readNdjson<CompareEvent>(res.body, (event) => {
          if (!current()) return;
          switch (event.event) {
            case "articles":
              setArticles((prev) => ({ ...prev, ...event.articles }));
              break;
            case "claim":
              setLiveClaims((claims) => [...claims, event.claim]);
              break;
            case "done":
              final = { ...event.result, fromCache: event.fromCache, cache: event.cache };
              break;
            case "error":
              failed = event.error;
              break;
          }
        });

        if (!current()) return;
        if (failed) throw new Error(failed);
        if (!final) throw new Error("The comparison ended without returning a result.");

        setData(final);
        setArticles((final as ComparePayload).articles);
        refreshMe();
      } catch (e) {
        if (!current()) return;
        setFundError(e instanceof Error ? e.message : "That didn't work.");
      } finally {
        // Unconditional: `funding` is this button's own busy flag, not part of
        // what a stale run is forbidden from touching. Leaving it set because
        // the reader followed a link elsewhere mid-purchase would jam the
        // button for good the next time this article's gate is seen.
        setFunding(false);
      }
    },
    [target, funding, data?.qid, refreshMe],
  );

  // Fired off the payload rather than from `open`, because `open` does not know
  // yet which of the three things it will turn out to be — cached, preview or a
  // full run — and that distinction is the whole reason to count opens.
  useEffect(() => {
    if (!data) return;
    void track("article_opened", {
      qid: data.qid,
      cached: data.fromCache,
      scope: data.scope?.kind ?? "full",
    });
    if (data.scope?.kind === "preview") void track("preview_gate_shown", { qid: data.qid });
  }, [data]);

  // A tooltip reached by keyboard needs a way out that isn't Tab. Blur alone
  // leaves someone who opened the card with focus no way to dismiss it in place.
  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCard(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card]);

  /** The single move behind both the floating switch and the swipe, which is
   *  what keeps them saying the same thing. The card goes with the column that
   *  raised it: its mark is about to be unmounted, and a tooltip outliving the
   *  text it points at is worse than no tooltip. */
  const readIn = (lang: Lang) => {
    if (!solo || lang === solo) return;
    setEnterFrom(available.indexOf(lang) > available.indexOf(solo) ? 1 : -1);
    setActive(lang);
    setCard(null);
  };

  // Clamped rather than wrapped: with the switch on screen showing where in the
  // three you are, a flick off the end that reappeared at the other end would
  // read as having lost your place.
  const swipe = useSwipe((direction) => {
    if (!solo) return;
    const next = available[available.indexOf(solo) + direction];
    if (next) readIn(next);
  });

  const toggle = (lang: Lang) =>
    setShown((current) =>
      current.includes(lang)
        ? current.length > 1
          ? current.filter((l) => l !== lang)
          : current
        : [...current, lang].sort((a, b) => LANGS.indexOf(a) - LANGS.indexOf(b)),
    );

  // Disabled for now — grouping the coverage panel by language and making its
  // pills jump to their mention needs more design work before it's ready to
  // show. The full version, plus the `qid` plumbing it reads from, is at
  // commit fbabb9e.
  //
  // /** A coverage pill's promise: bring that language's column on screen — solo
  //  *  it on a phone, toggle it back into `shown` on a wide one, or do neither
  //  *  if it's already there — and queue the jump for the effect below, which
  //  *  waits for the column to actually be `visible` before it goes looking. */
  // const jumpToLink = (lang: Lang, qid: string) => {
  //   if (narrow) readIn(lang);
  //   else if (!shown.includes(lang)) toggle(lang);
  //   setPendingLink({ lang, qid });
  // };
  //
  // // Runs the jump queued above once its column is on screen. The mark itself
  // // may not exist the instant that happens — bringing a column back into
  // // `shown` re-triggers `Columns`' band layout, which settles over a few
  // // frames — so this polls rather than reading the DOM once. It gives up
  // // silently past a budget: a concept linked only from the infobox has no mark
  // // in the body at all, the key-facts block having flattened its links to
  // // plain text, and no amount of waiting finds one.
  // useEffect(() => {
  //   if (!pendingLink) return;
  //   if (!visible.includes(pendingLink.lang)) return;
  //   const { lang, qid } = pendingLink;
  //   let attempts = 0;
  //   let frame = requestAnimationFrame(function tick() {
  //     const el = document.querySelector<HTMLElement>(
  //       `section[data-edition="${lang}"] [data-qid="${qid}"]`,
  //     );
  //     if (el) {
  //       const y = el.getBoundingClientRect().top + window.scrollY - SCROLL_CLEARANCE;
  //       window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
  //       el.classList.remove("diff-flash", "animate-diff-flash");
  //       void el.offsetWidth; // restart the animation if the same mark is re-targeted
  //       el.classList.add("diff-flash", "animate-diff-flash");
  //       setPendingLink(null);
  //       return;
  //     }
  //     if (++attempts > 30) {
  //       setPendingLink(null);
  //       return;
  //     }
  //     frame = requestAnimationFrame(tick);
  //   });
  //   return () => cancelAnimationFrame(frame);
  // }, [pendingLink, visible]);

  const onEnter = (claim: Claim, event: React.MouseEvent | React.FocusEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();

    // Clamp both edges. Clamping only the right edge pushed the card off-screen
    // for a mark near the left of the viewport, which the rightmost column makes
    // likelier once it is the only one shown. The width is the card's own only
    // while the viewport can hold it — on a phone the card is as wide as the
    // screen allows, and clamping against 340 there pinned every card to the
    // left margin.
    const width = Math.min(CARD_WIDTH, window.innerWidth - CARD_MARGIN * 2);
    const left = Math.max(
      CARD_MARGIN,
      Math.min(rect.left, window.innerWidth - width - CARD_MARGIN),
    );

    // Anchoring by `bottom` when flipping is what makes the flip real: setting
    // `top` to just above the mark still lays the card out downwards, so it
    // covered the very text it was explaining. This needs no height measurement.
    const flip = rect.bottom + CARD_CLEARANCE > window.innerHeight;
    setCard(
      flip
        ? { claim, left, bottom: window.innerHeight - rect.top + CARD_MARGIN }
        : { claim, left, top: rect.bottom + CARD_MARGIN },
    );
  };

  const hasColumns = visible.length > 0;
  const comparing = phase === "comparing";
  const landing = phase === "idle" && !error;
  const mastheadSearch = !landing || docked;
  /** Whether the floating language switch is over the bottom of the page, which
   *  the footer has to keep its last line clear of. */
  const langSwitch =
    narrow && !!solo && hasColumns && (comparing || phase === "done") && available.length > 1;

  return (
    <>
      {/* Sticky on the landing page only. That page now scrolls far enough that
          a masthead pinned to the top of the document would be gone by the
          second section, taking the search and the credit meter with it — but a
          comparison must not have one. Everything that scrolls a mark into view
          there (DiffNav, the internal links, a jump from the URL) lands it at
          the top of the viewport, and a sticky header sits on top of exactly
          that spot: the mark arrives already covered, and the hover card it is
          supposed to open never opens. `npm run check:ui` catches this. */}
      <header
        className={`masthead z-40 border-b border-rule bg-paper px-[24px] py-[20px] flex gap-[24px] items-center flex-wrap max-tight:px-[18px] max-tight:py-[14px] max-tight:gap-[14px] ${
          landing ? "sticky top-0" : ""
        }`}
      >
        <Wordmark />
        {/* On the landing page this appears only once the hero's own field has
            scrolled away — see `docked`. Everywhere else it is the only search
            there is, so it is always here. */}
        {mastheadSearch && (
          <SearchBox
            variant="bar"
            // Last and full width on a phone, so the masthead is the wordmark
            // and the credit meter on one line with the field under them,
            // rather than the field taking a line and leaving the meter alone
            // on a third.
            className="animate-reveal-in flex-[1_1_320px] max-tight:order-last max-tight:basis-full"
            value={query}
            onChange={setQuery}
            onSubmit={search}
            busy={busy}
          />
        )}
        <div className="ms-auto">
          <CreditBar me={me} onDonate={() => goDonate("masthead")} />
        </div>
      </header>

      {(comparing || phase === "done") && hasColumns && (
        <div className="controls border-b border-rule px-[24px] py-[12px] max-tight:px-[18px] max-tight:py-[10px] flex gap-x-[28px] gap-y-[20px] max-cols:gap-x-[16px] max-cols:gap-y-[10px] items-center flex-wrap font-mono text-[12px]">
          {/* How long each edition is, and which of them are on screen. The
              same chart serves both layouts because "on screen" is one
              sentence in both, but it is not the same question underneath: a
              wide screen is choosing which editions sit beside each other and
              can hold several at once, a narrow one is choosing the single
              column it is reading. So the press does what that screen means by
              it, and the floating switch stays the control under the thumb —
              this is the copy at the top of the page, where a reader who has
              just opened an article finds out that the version they are about
              to read is a tenth of the length of the one they are not. */}
          <LangBars
            langs={available}
            articles={articles}
            onScreen={visible}
            onPick={narrow ? readIn : toggle}
          />
          <Legend />
          {/* A line of its own below `cols`, rather than whatever is left over
              beside the legend: given the leftover, it squeezes the legend into
              wrapping labels it has the room to set on one line each. */}
          <div className="meta text-ink-soft ms-auto max-cols:ms-0 max-tight:basis-full">
            {/* What it cost to process this article, whoever paid it and
                whenever they did — see `costNote`. The badge beside it says
                "cached" in its own right, so the sentence never repeats it. */}
            {data ? (
              <span title={tokenNote(data)}>
                {data.qid} · {claims.length} marked
                {costNote(data) ? ` · ${costNote(data)}` : ""}
              </span>
            ) : claims.length ? (
              // Mid-run: the qid and the cost are not known yet, but the count
              // is, and it is climbing on the page beside this line.
              `${claims.length} marked so far…`
            ) : (
              "reading all three…"
            )}
            {/* Only when the cached answer and Wikipedia have actually diverged.
                An exact-revision hit is cached too, but it describes the live
                text, so badging it would cry wolf on the ordinary case. */}
            {badged && data?.cache && (
              <span
                className="cached-badge group relative inline-flex items-center gap-[5px] ms-[9px] px-[7px] py-[2px] border border-rule bg-paper-raised font-mono text-[10px] tracking-[0.09em] uppercase text-ink-soft cursor-default before:content-[''] before:w-[5px] before:h-[5px] before:rounded-full before:bg-framing"
                tabIndex={0}
                aria-describedby="cached-note"
              >
                cached
                {/* Not a tooltip any more, and not labelled as one: it contains
                    the button that keeps the promise its last sentence makes, so
                    it is a small popover. The note alone is what describes the
                    badge; the button is a control beside it, reachable by
                    pointer (the panel stays open while the pointer is anywhere
                    inside it) and by Tab (it stays open while anything in it has
                    focus). Signed out, the button goes to the donate page rather
                    than to a 401 — it should never be a dead end for the reader
                    who believed the sentence above it. */}
                {/* The panel is a DOM child of the badge, so `group-hover` /
                    `group-focus-within` on the badge keep it open while the
                    pointer or focus is anywhere inside it — except for the 8px
                    gap between the badge's bottom edge and the panel's top edge,
                    where nothing is painted at all. Crossing that empty band on
                    the way down drops the hover before the pointer ever reaches
                    the button, so the `::before` bridge below paints 9px over
                    the gap (one pixel of overlap with the badge, so there is no
                    seam at either end). A Playwright test walks the mouse from
                    badge to button in twelve steps specifically to catch this
                    regressing. `focus-within`, not `focus-visible`, is what lets
                    Tab reach the button — it is only focusable once the panel is
                    visible. Visibility toggles rather than display so the panel
                    can be measured and clicked mid-transition, and it takes
                    pointer events only while open, so a click passes through to
                    the strip underneath when it is closed. */}
                <span className="cached-tip absolute z-50 top-[calc(100%_+_8px)] end-0 w-[min(300px,calc(100vw_-_36px))] px-[13px] py-[11px] bg-paper-raised border border-ink rounded-[2px] shadow-offset font-body text-[13px] leading-[1.55] tracking-normal normal-case text-start text-ink opacity-0 invisible pointer-events-none transition-opacity duration-[120ms] ease-[ease] grid justify-items-start gap-[10px] group-hover:opacity-100 group-hover:visible group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:visible group-focus-within:pointer-events-auto before:content-[''] before:absolute before:inset-x-0 before:-top-[9px] before:h-[9px]">
                  <span id="cached-note">{cacheNote(data.cache)}</span>
                  {/* Filled rather than underlined: it sits directly under a
                      sentence, where a link would read as the end of that
                      sentence instead of the answer to it. */}
                  <button
                    className="cached-update px-[11px] py-[5px] border border-ink rounded-[2px] bg-ink text-paper-raised font-mono text-[11px] tracking-[0.07em] uppercase hover:enabled:bg-ink-soft hover:enabled:border-ink-soft disabled:opacity-50 disabled:cursor-progress"
                    disabled={funding}
                    onClick={() => (me ? fund("refresh") : goDonate("stale-badge"))}
                  >
                    {funding ? "Re-reading…" : "Update this article"}
                  </button>
                </span>
              </span>
            )}
          </div>
        </div>
      )}

      {error && (
        <div className="state error text-ink-soft py-[64px] pe-[24px] ps-[16px] max-w-[58ch] border-s-[3px] border-contradiction">
          <h2 className="font-display text-[27px] font-normal text-ink m-0 mb-[10px]">That didn&apos;t work</h2>
          <p>{error}</p>
        </div>
      )}

      {/* The landing page. It holds none of the state above — the query, the
          search and the URL all stay here, and it works entirely through the
          callbacks below, which is what keeps its sections safe to restyle
          without going near the diff renderer. */}
      {landing && (
        <Landing
          query={query}
          setQuery={setQuery}
          onSearch={search}
          onOpen={navigate}
          busy={busy}
          recent={recent}
          recentLoading={recentLoading}
          relative={relative}
          onDonate={() => goDonate("landing_footer")}
          onDocked={setDocked}
        />
      )}

      {phase === "results" && (
        <div className="results px-[24px] pt-[40px] pb-[56px] max-w-[64ch]">
          <h2 className="font-display text-[27px] font-normal m-0 mb-[6px]">Which article did you mean?</h2>
          <p className="results-note text-ink-soft text-[14px] m-0 mb-[18px]">
            Results from {LANG_META[hits[0]?.lang as Lang]?.label ?? hits[0]?.lang} Wikipedia. The
            other languages are found through the article&apos;s Wikidata item.
          </p>
          <ul className="list-none m-0 p-0">
            {hits.map((hit) => (
              <li
                key={`${hit.lang}:${hit.title}`}
                className="flex items-baseline gap-[12px] border-t border-rule last:border-b last:border-rule"
              >
                <button
                  className="hit flex-1 text-start px-[4px] py-[12px] bg-transparent border-none hover:bg-paper-raised disabled:opacity-50 disabled:cursor-progress"
                  onClick={() => navigate(hit.title, hit.lang)}
                  disabled={busy}
                >
                  <span className="hit-title block text-[16px]">{hit.title}</span>
                  {hit.description && (
                    <span className="hit-desc block text-[13px] text-ink-soft">{hit.description}</span>
                  )}
                </button>
                <a
                  className="hit-link font-mono text-[11px] text-wiki-link no-underline whitespace-nowrap hover:underline"
                  href={hit.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  open on Wikipedia ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* A funded comparison is one grid. A preview is three pieces: what was
          read, the seam, and what wasn't — so the boundary lands as a single
          rule across all three columns instead of three fades at three heights.

          Both are held in the surface a swipe is made over. Keying it on the
          language remounts the article when that changes, which is what replays
          the slide: the column arrives from the side it was pulled in from, so a
          flick moves something visible rather than swapping the page under the
          reader. Scroll position is deliberately left alone — the reader was
          part-way down an article and is still part-way down the same article,
          in another language. */}
      {hasColumns && (comparing || phase === "done") && (
        <div
          key={narrow ? solo : "columns"}
          className={narrow ? "animate-lang-in" : undefined}
          style={narrow ? ({ "--lang-from": `${enterFrom * SLIDE_PX}px` } as React.CSSProperties) : undefined}
          {...(narrow ? swipe : null)}
        >
          {preview && data ? (
            <>
              <Columns
                articles={articles}
                visible={visible}
                claims={claims}
                activeId={card?.claim.id ?? null}
                processedThrough={data.scope?.processedThrough}
                part="head"
                onEnter={onEnter}
                onLeave={() => setCard(null)}
                onLink={navigate}
              />
              <PreviewGate
                busy={funding}
                signedIn={!!me}
                creditCents={me?.creditCents ?? 0}
                error={fundError}
                onFund={() => fund("full")}
                onDonate={() => goDonate("preview-gate")}
              />
              <Columns
                articles={articles}
                visible={visible}
                claims={claims}
                processedThrough={data.scope?.processedThrough}
                part="tail"
                onLink={navigate}
              />
            </>
          ) : (
            <Columns
              articles={articles}
              visible={visible}
              claims={claims}
              // Ghosts stand in for marks nobody has yet. The first real
              // difference retires them: drifting placeholders beside located
              // claims read as though the located ones were still moving.
              ghost={(comparing || funding) && claims.length === 0}
              activeId={card?.claim.id ?? null}
              onEnter={onEnter}
              onLeave={() => setCard(null)}
              onLink={navigate}
            />
          )}
        </div>
      )}

      {/* The second or so before `/api/articles` answers, when the page would
          otherwise be a masthead and a loading panel over nothing. All three
          editions are drawn because which ones this subject actually has is
          one of the things the fetch is about to say; a column for an edition
          that turns out not to exist simply doesn't arrive. Below `cols` only
          the language that will be on screen first is drawn — `active` is what
          `solo` resolves to whenever the article has it. */}
      {comparing && !hasColumns && <ArticlesSkeleton langs={narrow ? [active] : [...LANGS]} />}

      {langSwitch && <LangSwitch langs={available} active={solo!} onChange={readIn} />}

      {/* The panel hands over to the stepper the moment there is something to
          step through. Until then it is the only thing that can say what is
          happening; after, it would be prose about work the reader can watch. */}
      {comparing && claims.length === 0 && <Loading title={target?.title ?? ""} reading={hasColumns} />}

      {/* Outside the `done` block, because the stepper is now live during the
          read as well: differences stream in, and the ones that have arrived
          are already worth jumping between. `busy` also covers the wait after
          donating, which buys the rest of the article on the same page. */}
      {claims.length > 0 && (comparing || funding || phase === "done") && (
        <DiffNav
          // The claim count is in the signature because each one that lands
          // renders new marks, and the rail plots marks it has measured.
          signature={`${data?.qid ?? target?.title ?? ""}:${visible.join("")}:${claims.length}`}
          busy={comparing || funding}
        />
      )}

      {phase === "done" && data && (
        <>

          {/* "Covered in some versions, not others" is disabled for now — the
              flat pill list this section used to show wasn't worth reviving,
              and the grouped-by-language, click-to-jump redesign below needs
              more work before it's ready to ship. Re-enable by restoring this
              block along with jumpToLink/pendingLink/coverageColumns/
              SCROLL_CLEARANCE above.
          {data.coverage.length > 0 && (
            <div
              className="coverage border-t border-rule p-[24px] max-cols:pb-[96px] max-tight:px-[18px]"
            >
              <h2 className="font-display font-normal text-[24px] m-0 mb-[4px]">Covered in some versions, not others</h2>
              <p className="text-ink-soft m-0 mb-[16px] max-w-[62ch] text-[14px]">
                Linked concepts one version mentions and another never does. Computed by set
                arithmetic over Wikidata identifiers, so no model reads a word of this — click a
                concept to jump to where its own version mentions it.
              </p>
              <div
                className="gap-cols grid gap-x-[24px] gap-y-[20px] max-cols:grid-cols-1"
                style={narrow ? undefined : { gridTemplateColumns: `repeat(${coverageColumns.length}, minmax(0, 1fr))` }}
              >
                {coverageColumns.map(({ lang, gaps }) => (
                  <div key={lang} className="gap-col min-w-0">
                    <h3 className="font-mono text-[11px] tracking-[0.09em] uppercase text-ink-soft m-0 mb-[9px] pb-[6px] border-b border-rule">
                      {LANG_META[lang].label}
                    </h3>
                    <div className="gaps flex flex-wrap gap-[6px]">
                      {gaps.map((gap) => (
                        <button
                          key={gap.qid}
                          className="gap font-mono text-[11px] px-[9px] py-[4px] border border-rule bg-paper-raised text-start cursor-pointer hover:bg-ink-wash"
                          onClick={() => jumpToLink(lang, gap.qid)}
                          title={`Not in ${gap.missingFrom.map((l) => LANG_META[l].label).join(", ")}`}
                        >
                          {gap.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          */}
        </>
      )}

      {/* Every page ends the same way. The landing page carries its own copy
          inside the grain overlay, so this is the footer for everything else —
          including a preview, where the faded remainder now stops rather than
          scrolling on into nothing. */}
      {!landing && (
        <Footer
          onDonate={() => goDonate("footer")}
          className={langSwitch ? "pb-[76px]" : ""}
        />
      )}

      {card && (
        <div
          className="card fixed z-50 max-w-[min(340px,calc(100vw_-_16px))] px-[15px] py-[13px] bg-paper-raised border border-ink rounded-[2px] shadow-offset pointer-events-none [direction:ltr] text-start"
          id="claim-card"
          style={{ left: card.left, top: card.top, bottom: card.bottom }}
          role="tooltip"
        >
          <span
            className="kind font-mono text-[10px] tracking-[0.09em] uppercase block mb-[5px] data-[type=contradiction]:text-contradiction data-[type=unique]:text-unique data-[type=framing]:text-framing"
            data-type={card.claim.type}
          >
            {KIND_LABEL[card.claim.type]}
          </span>
          <span className="summary font-semibold block mb-[5px]">{card.claim.summary}</span>
          <span className="explanation text-[14px] leading-[1.55] text-ink-soft">{card.claim.explanation}</span>
          <div className="also font-mono text-[11px] text-ink-soft mt-[9px] pt-[8px] border-t border-rule">
            marked in {Object.keys(card.claim.spans).map((l) => l.toUpperCase()).join(", ")}
          </div>
        </div>
      )}
    </>
  );
}
