"use client";

import { useEffect, useRef } from "react";
import Footer from "../Footer";
import Hero from "./Hero";
import RecentList from "./RecentList";
import Section from "./Section";
import type { RecentArticle } from "@/lib/types";

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
  onFeedback: () => void;
  /** Told when the hero's search field has scrolled out of reach, so the
   *  masthead can grow one of its own. */
  onDocked: (docked: boolean) => void;
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
  onFeedback,
  onDocked,
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

    const observer = new IntersectionObserver(
      ([entry]) => onDocked(!entry.isIntersecting),
      // The masthead covers the top of the viewport, so the sentinel is out of
      // reach a little before it is out of the window.
      { rootMargin: "-72px 0px 0px 0px" },
    );
    observer.observe(mark);
    return () => observer.disconnect();
  }, [onDocked]);

  return (
    // The grain. One tiled turbulence at very low opacity, which is the whole
    // difference between paper and a grey rectangle. `fixed` so it does not
    // travel with the content and read as a texture printed on the page.
    <main className="landing relative overflow-x-clip">
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

        <Section
          heading=""
          className="border-y border-rule bg-paper-22 pt-[max(6vh,48px)] pb-[max(7vh,52px)]"
        >
          <div className="mt-7 grid gap-8 md:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] md:items-center md:gap-14">
            <div className="max-w-136">
              <p className="mb-5 font-mono text-[11px] tracking-[0.12em] uppercase text-ink-soft">
                Why Compare?
              </p>
              <p className="m-0 font-display text-[clamp(34px,4.4vw,49px)] leading-[0.98] tracking-[-0.02em] text-ink">
                Wikipedia is not a source of truth.
              </p>
              <p className="mt-6 mb-0 max-w-[52ch] text-[16px] leading-[1.65] text-ink-soft">
                Wikipedia is written by people, influenced by environemts and perspectives.
                <br/> 
                I'm building Wiki Compare to combat this bias and help people read more critically, while being aware of their own bias. 
                <br/>
                <br/>
                Wikipedia edit wars have always been a thing, everyone fights for their point of view to be the truth. 
                I'm not here to take a side, just to make it easier for you to see different perspectives.
              </p>
            </div>

            <figure className="relative m-0 border border-ink bg-paper-raised p-2.5 shadow-offset md:-rotate-1">
              <img
                src="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/Wikipedia_Edit_Wars.jpg/500px-Wikipedia_Edit_Wars.jpg?utm_source=en.wikipedia.org&utm_campaign=parser&utm_content=thumbnail"
                alt="Wikipedia edit wars"
                className="aspect-4/3 w-full object-cover pt-1"
              />
              <figcaption className="flex items-baseline justify-between gap-4 pt-2 font-mono text-[10px] tracking-[0.08em] uppercase text-ink-soft max-tight:flex-col max-tight:items-start max-tight:gap-1">
                <span className="shrink-0">Wikipedia edit wars</span>
                <span className="min-w-0 flex-1 truncate text-[8px] normal-case tracking-normal max-tight:w-full max-tight:overflow-visible max-tight:text-clip max-tight:whitespace-normal">
                  <a
                    href="https://commons.wikimedia.org/wiki/File:Wikipedia_Edit_Wars.jpg"
                    className="text-ink-soft underline underline-offset-[3px] hover:text-ink"
                  >
                    Časopis Respekt, Pavel Reisenauer
                  </a>
                  {", "}
                  <a
                    href="https://creativecommons.org/licenses/by-sa/4.0"
                    className="text-ink-soft underline underline-offset-[3px] hover:text-ink"
                  >
                    CC BY-SA 4.0
                  </a>
                  , via Wikimedia Commons
                </span>
              </figcaption>
            </figure>
          </div>
        </Section>

        <RecentList recent={recent} onOpen={onOpen} relative={relative} loading={recentLoading} />
        <Footer onDonate={onDonate} onFeedback={onFeedback} />
      </div>
    </main>
  );
}
