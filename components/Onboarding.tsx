"use client";

import { useCallback, useEffect, useState } from "react";
import type { MeResponse } from "@/lib/types";

/**
 * One dot, moving.
 *
 * Three things on this site have to be explained before the page means anything:
 * the length chart, the marks in the prose, and the credit the account arrives
 * with. Each of them used to explain itself the moment it appeared — a panel
 * with a "Got it" button, opened at nobody's request — which is three
 * interruptions to a reader who came to read an article, in an order the reader
 * did not choose and could not defer.
 *
 * So the explanation waits behind a pulsing dot on the feature itself. The dot
 * asks for attention and costs nothing to refuse; hovering it is the reader
 * saying yes, and dismissing what it opens moves the dot to the next feature.
 * Only one dot exists at a time, which is what makes the sequence a tour rather
 * than three badges to clear.
 */
export type OnboardingStep = "bars" | "marks" | "credits";

/** The order, as the sequence itself. `null` is the end of the tour. */
const NEXT: Record<OnboardingStep, OnboardingStep | null> = {
  bars: "marks",
  marks: "credits",
  credits: null,
};

/** Where the tour got to on this device. One cursor rather than a flag per
 *  panel, because the ordering is the feature: three independent flags cannot
 *  say which dot is the current one. */
const CURSOR = "wiki-compare:onboarding";

/** The three per-panel flags the old flow wrote. A device that already sat
 *  through any of those panels has been taught, and must not be taught again by
 *  a new key it has never heard of. */
const LEGACY = [
  "wiki-compare:langbars-seen",
  "wiki-compare:legend-seen",
  "wiki-compare:welcome-seen",
];

function readCursor(): OnboardingStep | null {
  try {
    const at = localStorage.getItem(CURSOR);
    if (at) return at in NEXT ? (at as OnboardingStep) : null;
    return LEGACY.some((key) => localStorage.getItem(key) === "1") ? null : "bars";
  } catch {
    // Storage can be denied outright (private mode, a locked-down browser).
    // The tour is worth running once even where its progress cannot stick.
    return "bars";
  }
}

function writeCursor(step: OnboardingStep | null): void {
  try {
    localStorage.setItem(CURSOR, step ?? "done");
  } catch {}
}

/**
 * Which feature the dot is on, and how to move it along.
 *
 * Lives in the page rather than in the three components, for the same reason the
 * cursor is one key: whose turn it is is not a fact any one of them holds.
 *
 * The account is what ends the tour. The last step is the credit bar, which only
 * exists once somebody has signed in, so a reader who never logs in is left with
 * the cursor parked on `credits` — the tour is unfinished, which is the truth.
 * Finishing it POSTs the flag, so the next device starts with no dots at all.
 */
export function useOnboarding(me: MeResponse | null): {
  step: OnboardingStep | null;
  done: () => void;
} {
  /** Starts `null` so no dot can flash in during hydration and then vanish once
   *  the cursor is read. */
  const [step, setStep] = useState<OnboardingStep | null>(null);

  useEffect(() => {
    setStep(readCursor());
  }, []);

  const settle = useCallback((next: OnboardingStep | null) => {
    setStep(next);
    writeCursor(next);
    // Fire-and-forget, and unauthenticated callers are answered with a 401 that
    // nothing here reads: the cursor above is what this device goes by, and the
    // column is what a second device goes by.
    if (!next) fetch("/api/onboarding", { method: "POST" }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!me) return;
    if (me.onboardingDone) {
      // Taught on another device. Not `settle`, which would POST a flag the
      // server is the one that just told us about.
      setStep(null);
      writeCursor(null);
    } else if (step === "credits" && !me.newcomer) {
      // The credit note explains the sign-up grant, and this account is already
      // past it. Nothing left to point at, so the tour is over.
      settle(null);
    }
  }, [me, step, settle]);

  return {
    step,
    done: useCallback(() => settle(step ? NEXT[step] : null), [settle, step]),
  };
}

/**
 * The dot. Absolutely positioned, so every feature that carries one needs to be
 * a positioned box — all three already are, because each one anchors a panel to
 * the same corner.
 *
 * A button, not a decorated span: it is hoverable *and* pressable, which is the
 * only way it works on a touch screen and on a keyboard. `reveal` is the same
 * call for all three, so the explanation opens however the reader arrived.
 *
 * The pulse is on the span inside rather than on the button, so the thing being
 * pointed at holds still while only its ink breathes. A button whose own box
 * scales is a target that moves out from under the pointer — and one that never
 * settles, which is a hover Playwright will wait out the clock for.
 */
export function OnboardingDot({ reveal, label }: { reveal: () => void; label: string }) {
  return (
    <button
      type="button"
      className="onboarding-dot absolute z-50 -top-[7px] -end-[7px] grid place-items-center w-[9px] h-[9px] p-0 border-0 bg-transparent"
      aria-label={label}
      onMouseEnter={reveal}
      onFocus={reveal}
      onClick={reveal}
    >
      <span
        aria-hidden="true"
        className="block w-full h-full rounded-full bg-contradiction shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-contradiction)_22%,transparent)] animate-attention-pulse"
      />
    </button>
  );
}
