"use client";

import type { ReactNode } from "react";
import LangBars from "../LangBars";
import Legend from "../Legend";
import type { OnboardingStep } from "../Onboarding";
import type { ArticleSnapshot, Lang } from "@/lib/types";

/**
 * The strip above the columns: how long each edition is, what the marks mean,
 * and — in `meta` — what this comparison is and what it cost.
 *
 * The length chart serves both layouts because "on screen" is one sentence in
 * both, but it is not the same question underneath: a wide screen is choosing
 * which editions sit beside each other and can hold several at once, a narrow
 * one is choosing the single column it is reading. So the press does what that
 * screen means by it, and the floating switch stays the control under the thumb.
 */
export default function ControlStrip({
  langs,
  articles,
  onScreen,
  onPick,
  onboarding,
  meta,
}: {
  langs: Lang[];
  articles: Record<string, ArticleSnapshot>;
  onScreen: Lang[];
  onPick: (lang: Lang) => void;
  onboarding: { step: OnboardingStep | null; done: () => void };
  meta: ReactNode;
}) {
  return (
    <div className="controls border-b border-rule px-[24px] py-[12px] max-tight:px-[18px] max-tight:py-[10px] flex gap-x-[28px] gap-y-[20px] max-cols:gap-x-[16px] max-cols:gap-y-[10px] items-center flex-wrap font-mono text-[12px]">
      <LangBars
        langs={langs}
        articles={articles}
        onScreen={onScreen}
        onPick={onPick}
        hint={onboarding.step === "bars"}
        onHintDone={onboarding.done}
      />
      <Legend hint={onboarding.step === "marks"} onHintDone={onboarding.done} />
      {meta}
    </div>
  );
}
