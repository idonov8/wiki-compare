"use client";

import { useEffect, useState } from "react";
import type { RecentArticle } from "@/lib/types";

/**
 * The ledger of recently cached comparisons, refetched on every return to the
 * landing state so an article compared and then backed out of is at the top of
 * the list waiting.
 *
 * `loading` is never reset back to true on a later fetch — a returning visitor
 * still has the last list on screen, and re-skeletoning it would trade one jump
 * for another.
 */
export function useRecent(enabled: boolean): { recent: RecentArticle[]; loading: boolean } {
  const [recent, setRecent] = useState<RecentArticle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Reading the URL rather than trusting the phase alone keeps a deep link
    // from spending a request on a list it will never show: `idle` is also the
    // phase of the first render, before the article named in the querystring
    // has been opened.
    if (!enabled || new URLSearchParams(window.location.search).get("title")) return;
    const abort = new AbortController();
    fetch("/api/recent", { signal: abort.signal })
      .then((res) => res.json())
      .then((json) => {
        setRecent(json.items ?? []);
        setLoading(false);
      })
      // Not a `.finally`: an aborted request (StrictMode's mount-cleanup-mount
      // in dev, or a phase change mid-flight) lands here too, and clearing the
      // skeleton on the abort would drop back to nothing while the effect's
      // real re-fetch is still in flight.
      .catch(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [enabled]);

  return { recent, loading };
}
