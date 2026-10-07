"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { comparePath } from "../Highlighted";
import type { Hit, Phase } from "./types";
import { track } from "@/lib/analytics";
import { streamComparison } from "@/lib/compare-stream";
import {
  LANGS,
  type ArticleSnapshot,
  type Claim,
  type ComparePayload,
  type ComparisonScope,
  type Lang,
} from "@/lib/types";

const asLang = (value: string | null): Lang =>
  value && (LANGS as readonly string[]).includes(value) ? (value as Lang) : "en";

/**
 * Everything about the article on screen: finding it, reading it, paying for
 * the rest of it, and keeping it in the URL so it is linkable and the back
 * button works.
 *
 * The comparison is one streaming request that reports as it goes. It used to
 * be two — `/api/articles` for the columns and `/api/compare` for the marks —
 * on the theory that the second would find the article cache the first had
 * warmed. It did not: nothing dedupes them, so on a cold article both fetched
 * all three editions and both ran the link-to-Wikidata resolution, doubling the
 * work and the rate-limit exposure to save nothing.
 */

/**
 * `?engine=jev` opens comparisons on the Jev proof of concept. Remembered for
 * the tab, because following a link inside an article builds a fresh URL that
 * would otherwise drop it; `?engine=claude` switches back.
 */
function engineParam(): string {
  try {
    const asked = new URLSearchParams(window.location.search).get("engine");
    if (asked) window.sessionStorage.setItem("engine", asked);
    return window.sessionStorage.getItem("engine") === "jev" ? "&engine=jev" : "";
  } catch {
    return new URLSearchParams(window.location.search).get("engine") === "jev" ? "&engine=jev" : "";
  }
}

export function useCompareSession({
  refreshMe,
  /** Run whenever a new read or search clears the page — the claim tooltip
   *  belongs to marks that are about to be replaced. */
  onReset,
}: {
  refreshMe: () => void;
  onReset: () => void;
}) {
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
  const [liveScope, setLiveScope] = useState<ComparisonScope | null>(null);
  const [funding, setFunding] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);
  /** The thank-you, up for nine seconds from the moment credit is spent. */
  const [thanks, setThanks] = useState(false);

  /** The querystring we last acted on, so a pushState of our own doesn't look
   *  like a navigation to re-apply. */
  const appliedUrl = useRef<string | null>(null);
  /** Bumped at the top of every read. A stream outlives the article it was
   *  started for — following a link or pressing back begins another one while
   *  the first is still arriving — so each read stamps its id here and ignores
   *  any event once a later read has taken over. Without this the stale run's
   *  claims blend into the new page and its `done` line replaces it. */
  const runId = useRef(0);
  /** Read inside `open` so the callback can stay stable across renders. */
  const hasHits = useRef(false);
  hasHits.current = hits.length > 0;

  const reset = useCallback(() => {
    setError(null);
    setFundError(null);
    onReset();
  }, [onReset]);

  const open = useCallback(
    async (hit: Hit) => {
      // This read supersedes any still arriving from an article the reader has
      // moved on from, whose events land on the floor from here on.
      const id = ++runId.current;
      const current = () => runId.current === id;

      reset();
      setTarget(hit);
      setArticles({});
      setData(null);
      setLiveClaims([]);
      setLiveScope(null);
      setPhase("comparing");

      try {
        const res = await fetch(
          `/api/compare?title=${encodeURIComponent(hit.title)}&lang=${encodeURIComponent(hit.lang)}&stream=1${engineParam()}`,
        );
        const final = await streamComparison(res, {
          accept: current,
          articles: setArticles,
          scope: setLiveScope,
          claim: (claim) => setLiveClaims((claims) => [...claims, claim]),
        });
        if (!current()) return;
        setData(final);
        setArticles(final.articles);
        setPhase("done");
      } catch (e) {
        if (!current()) return;
        setError(e instanceof Error ? e.message : "Comparison failed.");
        setPhase(hasHits.current ? "results" : "idle");
      }
    },
    [reset],
  );

  const navigate = useCallback(
    (title: string, lang: string) => {
      const t = title.trim();
      if (!t) return;
      setQuery(t);
      setHits([]);
      window.history.pushState(null, "", comparePath(t, lang));
      appliedUrl.current = window.location.search;
      window.scrollTo({ top: 0 });
      void open({ lang, title: t, url: "" });
    },
    [open],
  );

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
      void open({ lang: asLang(params.get("lang")), title, url: "" });
    };
    apply();
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, [open]);

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
  }, [query, navigate, reset]);

  /**
   * Buy the rest of this article, or a re-read of one whose revisions have moved
   * on. The reply is the same stream `open` reads, so the page turns over as the
   * run reports it: the gate goes the moment the server says the scope is now
   * `full`, and the differences land as they are found. The gate disappears
   * because the payload it was describing is gone, not because anything told it
   * to.
   *
   * Nothing on the page moves on the press. A donation can still be refused —
   * not enough credit, somebody else funded it first — and blanking the article
   * optimistically would flash it away for a request that never started, and
   * take the gate that is the only place the refusal can be read with it.
   */
  const fund = useCallback(
    async (kind: "full" | "refresh") => {
      if (!target || funding) return;
      setFunding(true);
      setFundError(null);
      // Thanks for the donation, not for the wait: raised on the press, while
      // the run it paid for is still a minute from finishing.
      if (kind === "full") setThanks(true);
      void track(kind === "refresh" ? "stale_update_clicked" : "gate_cta_clicked", {
        qid: data?.qid,
        from: "fund",
      });

      /** The preview this run was bought to replace, put back if it fails. The
       *  articles go back with it: a refresh replaces them, and a comparison's
       *  claims are located in the text it was computed from, so an old payload
       *  over new articles marks the wrong words. */
      const previous = data;
      const previousArticles = articles;
      /** Where `runId` stood on the press. The run claims the page on the first
       *  line rather than here — a donation refused before it starts must not
       *  have killed a read that is still arriving — but only if nothing else
       *  has claimed it since, so following a link mid-donation leaves the
       *  reader on the article they went to. */
      const pressed = runId.current;
      let id = 0;
      const superseded = () => runId.current !== (id || pressed);
      /** The handover, run once, on the first line the server sends: this is now
       *  a full read of this article, and the preview's claims and scope belong
       *  to the answer being replaced. Clearing them puts the page back into the
       *  state `open` uses while it reads — ghost marks and the reading panel —
       *  which is exactly what is happening. */
      const begin = () => {
        if (id || superseded()) return;
        id = ++runId.current;
        setData(null);
        setLiveClaims([]);
        setLiveScope(null);
        setPhase("comparing");
      };

      try {
        const res = await fetch("/api/compare?stream=1", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: target.title, lang: target.lang, kind }),
        });
        const final = await streamComparison(
          res,
          {
            accept: (event) => {
              if (event.event !== "error") begin();
              return !superseded();
            },
            // Which columns are shown is left alone, unlike in `open`: this is
            // the same article the reader is already looking at, so a column
            // they put away should stay away.
            articles: setArticles,
            scope: setLiveScope,
            claim: (claim) => setLiveClaims((claims) => [...claims, claim]),
          },
          "That didn't work.",
        );

        // The spent credit and the article this account has now paid for, even
        // if the reader has since moved on: the money left the balance either
        // way, and the meter should not be the last to know.
        refreshMe();
        if (superseded()) return;

        setData(final);
        setArticles(final.articles);
        setPhase("done");
      } catch (e) {
        if (superseded()) return;
        const message = e instanceof Error ? e.message : "That didn't work.";
        // Nothing was read and the credit has been handed back, so the thanks
        // are withdrawn with it: a thank-you standing over an error message is
        // thanking somebody for a donation that did not happen.
        setThanks(false);
        if (!id) {
          // Refused before it started, so nothing was cleared: the preview and
          // its gate are still on screen, and that is where this belongs.
          setFundError(message);
        } else if (previous) {
          // Back to the preview, which is where the gate is, which is the only
          // place that error has to be read.
          setFundError(message);
          setData(previous);
          setArticles(previousArticles);
          setLiveClaims([]);
          setLiveScope(null);
          setPhase("done");
        } else {
          // Funded from a preview that was still reading, so there is no payload
          // to go back to and no gate to put this in. Reported the way `open`
          // reports a failed read — over the articles, which are still good.
          setError(message);
          setPhase("done");
        }
      } finally {
        setFunding(false);
      }
    },
    [target, funding, data, articles, refreshMe],
  );

  useEffect(() => {
    if (!thanks) return;
    const t = setTimeout(() => setThanks(false), 9000);
    return () => clearTimeout(t);
  }, [thanks]);

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

  return {
    query,
    setQuery,
    phase,
    busy,
    error,
    hits,
    target,
    articles,
    data,
    /** What is marked on the page right now: the finished run's claims, or the
     *  ones that have arrived so far while it is still reading. The finished run
     *  supersedes rather than merges — it is the same list, and it is the copy
     *  that got stored. */
    claims: data?.claims ?? liveClaims,
    /** How far the run on screen means to read: the finished run's own scope,
     *  or — while it is still reading — the cut it announced when the articles
     *  arrived. Same relationship as `claims`/`liveClaims`. */
    scope: data?.scope ?? liveScope,
    funding,
    fundError,
    thanks,
    search,
    navigate,
    fund,
  };
}
