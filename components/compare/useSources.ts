"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LANGS, type ArticleSnapshot, type SourcesPayload } from "@/lib/types";

/** How far ahead of the viewport the list starts loading. The sources sit
 *  under the whole article, so a reader who never scrolls that far never
 *  causes three reference lists to be fetched and parsed. */
const LOOKAHEAD = "900px 0px";

/**
 * The reference lists for whatever revisions the columns are showing.
 *
 * Fetched separately from the comparison, and deliberately late: it costs no
 * tokens and blocks nothing, so it has no business being in front of the
 * article. Keyed on the revision ids rather than on the subject, which is what
 * makes the answer immutable and cacheable — and what keeps a cached comparison
 * from being annotated with citations from a newer revision than the one on
 * screen.
 */
export function useSources(articles: Record<string, ArticleSnapshot>) {
  const query = useMemo(
    () =>
      LANGS.filter((lang) => articles[lang]?.revid)
        .map((lang) => `${lang}=${articles[lang].revid}`)
        .join("&"),
    [articles],
  );

  const anchor = useRef<HTMLElement>(null);
  const [near, setNear] = useState(false);
  const [sources, setSources] = useState<SourcesPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSources(null);
    setFailed(false);
  }, [query]);

  useEffect(() => {
    const el = anchor.current;
    if (!el || near) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: LOOKAHEAD },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near || !query) return;
    let live = true;
    void (async () => {
      try {
        const res = await fetch(`/api/sources?${query}`);
        if (!res.ok) throw new Error(`sources returned ${res.status}`);
        const payload = (await res.json()) as SourcesPayload;
        if (live) setSources(payload);
      } catch {
        // A missing sources list is a missing appendix, not a broken page.
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [near, query]);

  return { anchor, sources, failed, loading: near && !sources && !failed };
}
