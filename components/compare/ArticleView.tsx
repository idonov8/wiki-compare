"use client";

import type { ReactNode } from "react";
import Columns from "../Columns";
import LangSlide, { type LangSlideState } from "./LangSlide";
import type { Claim, Lang, ArticleSnapshot, ComparisonScope } from "@/lib/types";

/**
 * The article itself.
 *
 * A funded comparison is one grid. A preview is three pieces — what was read,
 * the seam, and what wasn't — so the boundary lands as a single rule across all
 * three columns instead of three fades at three heights.
 *
 * Both are held in `LangSlide`, which is the surface a swipe is made over on a
 * screen showing one column at a time.
 */
export default function ArticleView({
  slide,
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
  slide: LangSlideState;
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
    <LangSlide {...slide}>
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
    </LangSlide>
  );
}
