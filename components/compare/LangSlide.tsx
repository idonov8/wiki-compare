"use client";

import type { ReactNode } from "react";
import type { useSwipe } from "../useSwipe";
import type { Lang } from "@/lib/types";

/** How far the incoming column slides in from. Enough to read as the article
 *  having moved sideways, not as a new page. */
const SLIDE_PX = 26;

/** Which edition a one-column screen is reading, and how the reader moves it.
 *  Assembled once in `Compare` and handed to everything that shows a column, so
 *  the article and the sources under it can never be showing two languages. */
export interface LangSlideState {
  narrow: boolean;
  solo?: Lang;
  enterFrom: number;
  swipe: ReturnType<typeof useSwipe>;
}

/**
 * The surface a swipe is made over, below the breakpoint where the columns stop
 * fitting side by side.
 *
 * Keying it on the language remounts what is inside when that changes, which is
 * what replays the slide: the column arrives from the side it was pulled in
 * from, so a flick moves something visible rather than swapping the page under
 * the reader. Scroll position is deliberately left alone — the reader was
 * part-way down an article and is still part-way down the same article, in
 * another language.
 */
export default function LangSlide({
  narrow,
  solo,
  enterFrom,
  swipe,
  children,
}: LangSlideState & { children: ReactNode }) {
  return (
    <div
      key={narrow ? solo : "columns"}
      className={narrow ? "animate-lang-in" : undefined}
      style={
        narrow ? ({ "--lang-from": `${enterFrom * SLIDE_PX}px` } as React.CSSProperties) : undefined
      }
      {...(narrow ? swipe : null)}
    >
      {children}
    </div>
  );
}
