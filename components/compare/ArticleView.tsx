"use client";

import type { ReactNode } from "react";
import Columns from "../Columns";
import type { useSwipe } from "../useSwipe";
import type { Claim, Lang, ArticleSnapshot, ComparisonScope } from "@/lib/types";

/** How far the incoming column slides in from when the language changes. Enough
 *  to read as the article having moved sideways, not as a new page. */
const SLIDE_PX = 26;

/**
 * The article itself.
 *
 * A funded comparison is one grid. A preview is three pieces — what was read,
 * the seam, and what wasn't — so the boundary lands as a single rule across all
 * three columns instead of three fades at three heights.
 *
 * Both are held in the surface a swipe is made over. Keying it on the language
 * remounts the article when that changes, which is what replays the slide: the
 * column arrives from the side it was pulled in from, so a flick moves something
 * visible rather than swapping the page under the reader. Scroll position is
 * deliberately left alone — the reader was part-way down an article and is still
 * part-way down the same article, in another language.
 */
export default function ArticleView({
  narrow,
  solo,
  enterFrom,
  swipe,
  articles,
  visible,
  claims,
  scope,
  /** The seam and its offer, rendered between the two halves of a preview. */
  gate,
  ghost,
  activeId,
  onEnter,
  onLeave,
  onLink,
}: {
  narrow: boolean;
  solo?: Lang;
  enterFrom: number;
  swipe: ReturnType<typeof useSwipe>;
  articles: Record<string, ArticleSnapshot>;
  visible: Lang[];
  claims: Claim[];
  scope: ComparisonScope | null;
  gate: ReactNode;
  ghost: boolean;
  activeId: string | null;
  onEnter: (claim: Claim, event: React.MouseEvent | React.FocusEvent) => void;
  onLeave: () => void;
  onLink: (title: string, lang: string) => void;
}) {
  const shared = { articles, visible, claims, onLink };

  return (
    <div
      key={narrow ? solo : "columns"}
      className={narrow ? "animate-lang-in" : undefined}
      style={
        narrow ? ({ "--lang-from": `${enterFrom * SLIDE_PX}px` } as React.CSSProperties) : undefined
      }
      {...(narrow ? swipe : null)}
    >
      {scope?.kind === "preview" ? (
        <>
          <Columns
            {...shared}
            activeId={activeId}
            processedThrough={scope.processedThrough}
            part="head"
            onEnter={onEnter}
            onLeave={onLeave}
          />
          {gate}
          <Columns {...shared} processedThrough={scope.processedThrough} part="tail" />
        </>
      ) : (
        <Columns
          {...shared}
          // Ghosts stand in for marks nobody has yet. The first real difference
          // retires them: drifting placeholders beside located claims read as
          // though the located ones were still moving.
          ghost={ghost}
          activeId={activeId}
          onEnter={onEnter}
          onLeave={onLeave}
        />
      )}
    </div>
  );
}
