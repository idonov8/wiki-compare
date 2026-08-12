"use client";

import { useEffect, useRef } from "react";
import Footer from "../Footer";
import Hero from "./Hero";
import RecentList from "./RecentList";
import type { RecentArticle } from "@/lib/types";

/** How far past the docked masthead the hero's field has to come back before
 *  the masthead gives its search up again. Only has to exceed the rounding on a
 *  measured height — the height the masthead loses is accounted for above. */
const SETTLE = 2;

interface Props {
  query: string;
  setQuery: (value: string) => void;
  onSearch: () => void;
  /** Straight to a named article, skipping the picker: the try-these chips, the
   *  sample, and the recently-cached rows all know exactly which page they
   *  mean, so putting a search result list between them and it is only a step. */
  onOpen: (title: string, lang: string) => void;
  busy: boolean;
  recent: RecentArticle[];
  /** True until the first `/api/recent` response lands — see RecentList. */
  recentLoading: boolean;
  relative: (iso: string) => string;
  onDonate: () => void;
  /** Whether the masthead is currently carrying a search of its own. */
  docked: boolean;
  /** Told when the hero's search field has scrolled out of reach, so the
   *  masthead can grow one of its own. */
  onDocked: (docked: boolean) => void;
  /** The masthead itself, so the line below can be measured off what is
   *  actually covering the top of the viewport. */
  masthead: React.RefObject<HTMLElement | null>;
}

/**
 * The landing page: hero, one real example, the argument, the ledger, the ask.
 *
 * It owns no state of the comparison — `Compare` still holds the query, runs
 * the search and owns the URL. Everything here is presentation over callbacks,
 * which is what makes the sections safe to rearrange or restyle one at a time
 * without going near the diff renderer.
 */
export default function Landing({
  query,
  setQuery,
  onSearch,
  onOpen,
  busy,
  recent,
  recentLoading,
  relative,
  onDonate,
  docked,
  onDocked,
  masthead,
}: Props) {
  const sentinel = useRef<HTMLDivElement | null>(null);

  /**
   * Watching a one-pixel marker under the hero field, rather than the scroll
   * position: the hero's height depends on the viewport, the headline's
   * wrapping and whether the try-chips fell onto a second line, so any pixel
   * threshold picked here would be wrong on some screen. The observer asks the
   * only question that matters — is the field still reachable.
   */
  useEffect(() => {
    const mark = sentinel.current;
    if (!mark) return;
    if (typeof IntersectionObserver === "undefined") return;

    // The masthead covers the top of the viewport, so the sentinel is out of
    // reach a little before it is out of the window. Measured rather than
    // assumed, because docking a search into the masthead makes it taller —
    // by nine pixels on a wide window, by a whole row on a phone.
    //
    // That growth is also why the line moves with the state. The masthead sits
    // in the flow above the hero, so growing it pushes the sentinel down past
    // the line it had just crossed: with one fixed line, docking undocked
    // itself, which shrank the masthead, which docked again — the search box
    // flickering in and out for as long as the reader stayed within those few
    // pixels. Undocking asks for `SETTLE` more than the docked masthead
    // covers, so the crossing back is always clear of the height it gave up.
    const line =
      Math.round(masthead.current?.getBoundingClientRect().height ?? 72) +
      (docked ? SETTLE : 0);

    const observer = new IntersectionObserver(
      ([entry]) => onDocked(!entry.isIntersecting),
      { rootMargin: `-${line}px 0px 0px 0px` },
    );
    observer.observe(mark);
    return () => observer.disconnect();
  }, [onDocked, docked, masthead]);

  return (
    // The grain. One tiled turbulence at very low opacity, which is the whole
    // difference between paper and a grey rectangle. `fixed` so it does not
    // travel with the content and read as a texture printed on the page.
    <main className="landing relative">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 opacity-[0.5] mix-blend-multiply"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.055'/%3E%3C/svg%3E\")",
        }}
      />

      <div className="relative z-10">
        <Hero
          query={query}
          setQuery={setQuery}
          onSearch={onSearch}
          onPick={(title) => onOpen(title, "en")}
          busy={busy}
          sentinel={sentinel}
        />

        <RecentList recent={recent} onOpen={onOpen} relative={relative} loading={recentLoading} />
        <Footer onDonate={onDonate} />
      </div>
    </main>
  );
}
