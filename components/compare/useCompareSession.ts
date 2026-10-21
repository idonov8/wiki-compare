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
  type Lang,
} from "@/lib/types";

const asLang = (value: string | null): Lang =>
  value && (LANGS as readonly string[]).includes(value) ? (value as Lang) : "en";

/**
 * Everything about the article on screen: finding it, reading it, and keeping
 * it in the URL so it is linkable and the back button works.
 *
 * The comparison is one streaming request that reports as it goes. It used to
 * be two — `/api/articles` for the columns and `/api/compare` for the marks —
 * on the theory that the second would find the article cache the first had
 * warmed. It did not: nothing dedupes them, so on a cold article both fetched
 * all three editions and both ran the link-to-Wikidata resolution, doubling the
 * work and the rate-limit exposure to save nothing.
 */

export function useCompareSession({
  /** Run whenever a new read or search clears the page — the claim tooltip
   *  belongs to marks that are about to be replaced. */
  onReset,
}: {
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
   *  usage that only the finished run knows. */
  const [liveClaims, setLiveClaims] = useState<Claim[]>([]);

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
      setPhase("comparing");

      try {
        const res = await fetch(
          `/api/compare?title=${encodeURIComponent(hit.title)}&lang=${encodeURIComponent(hit.lang)}&stream=1`,
        );
        const final = await streamComparison(res, {
          accept: current,
          articles: setArticles,
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

  // Fired off the payload rather than from `open`, because `open` does not know
  // yet whether it will turn out to be cached or a fresh run, and that
  // distinction is the whole reason to count opens.
  useEffect(() => {
    if (!data) return;
    void track("article_opened", { qid: data.qid, cached: data.fromCache });
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
    search,
    navigate,
  };
}
