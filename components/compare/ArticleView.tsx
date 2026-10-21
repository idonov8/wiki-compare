"use client";

import Columns from "../Columns";
import LangSlide, { type LangSlideState } from "./LangSlide";
import type { Alignment, Claim, Lang, ArticleSnapshot } from "@/lib/types";

/**
 * The article itself, held in `LangSlide`, which is the surface a swipe is made
 * over on a screen showing one column at a time.
 */
export default function ArticleView({
  slide,
  articles,
  visible,
  claims,
  ghost,
  activeId,
  alignment,
  activeSentence,
  onEnter,
  onLeave,
  onLink,
  onSentence,
  onSentenceLeave,
}: {
  slide: LangSlideState;
  articles: Record<string, ArticleSnapshot>;
  visible: Lang[];
  claims: Claim[];
  ghost: boolean;
  activeId: string | null;
  alignment?: Alignment;
  activeSentence: string | null;
  /** Absent when the panel below takes over a mark's hover. */
  onEnter?: (claim: Claim, event: React.MouseEvent | React.FocusEvent) => void;
  onLeave: () => void;
  onLink: (title: string, lang: string) => void;
  onSentence: (key: string, element: HTMLElement, how: "hover" | "tap") => void;
  onSentenceLeave: () => void;
}) {
  return (
    <LangSlide {...slide}>
      <Columns
        articles={articles}
        visible={visible}
        claims={claims}
        onLink={onLink}
        // Ghosts stand in for marks nobody has yet. The first real difference
        // retires them: drifting placeholders beside located claims read as
        // though the located ones were still moving.
        ghost={ghost}
        activeId={activeId}
        alignment={alignment}
        activeSentence={activeSentence}
        onEnter={onEnter}
        onLeave={onLeave}
        onSentence={onSentence}
        onSentenceLeave={onSentenceLeave}
      />
    </LangSlide>
  );
}
