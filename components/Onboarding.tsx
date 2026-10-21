"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The three features that need explaining, in the order one pulsing dot
 * visits them: the length chart, then the marks key, then the sources
 * shortcut. Dismissing the note a feature opens — or, for the shortcut,
 * pressing it — moves the dot on, and only one dot exists at a time.
 */
export type OnboardingStep = "bars" | "marks" | "sources";

/** `null` is the end of the tour. */
const NEXT: Record<OnboardingStep, OnboardingStep | null> = {
  bars: "marks",
  marks: "sources",
  sources: null,
};

/** Where the tour got to on this device. One cursor rather than a flag per
 *  panel, because three independent flags cannot say whose turn it is. */
const CURSOR = "wiki-compare:onboarding";

/** The per-panel flags the old flow wrote: a device that saw any of those
 *  panels has been taught, and must not be taught again under the new key. */
const LEGACY = [
  "wiki-compare:langbars-seen",
  "wiki-compare:legend-seen",
  "wiki-compare:welcome-seen",
];

function readCursor(): OnboardingStep | null {
  try {
    const at = localStorage.getItem(CURSOR);
    // A cursor parked on a retired step has seen the remaining stops, so it
    // falls through to `null` along with "done".
    if (at) return at in NEXT ? (at as OnboardingStep) : null;
    return LEGACY.some((key) => localStorage.getItem(key) === "1") ? null : "bars";
  } catch {
    // Storage denied (private mode). Worth running once even where it cannot stick.
    return "bars";
  }
}

function writeCursor(step: OnboardingStep | null): void {
  try {
    localStorage.setItem(CURSOR, step ?? "done");
  } catch {}
}

/** Which feature the dot is on, and how to move it along. */
export function useOnboarding(): {
  step: OnboardingStep | null;
  done: () => void;
} {
  /** Starts `null` so no dot flashes in during hydration. */
  const [step, setStep] = useState<OnboardingStep | null>(null);

  useEffect(() => {
    setStep(readCursor());
  }, []);

  const settle = useCallback((next: OnboardingStep | null) => {
    setStep(next);
    writeCursor(next);
  }, []);

  return {
    step,
    done: useCallback(() => settle(step ? NEXT[step] : null), [settle, step]),
  };
}

/**
 * What opens the note: the whole feature, not the 9px dot. `onFocus` bubbles, so
 * the bars and the key's own button cover the keyboard case.
 */
export function hintTriggers(reveal: () => void): {
  onMouseEnter: () => void;
  onFocus: () => void;
  onTouchStart: () => void;
} {
  return { onMouseEnter: reveal, onFocus: reveal, onTouchStart: reveal };
}

/**
 * A mark on the feature and nothing more: no handlers, and hidden from screen
 * readers, which get the note itself on focus. Needs a positioned parent. The
 * pulse is on the inner span so the outer box never moves.
 */
export function OnboardingDot() {
  return (
    <span
      aria-hidden="true"
      className="onboarding-dot absolute z-50 -top-[7px] -end-[7px] grid place-items-center w-[9px] h-[9px] pointer-events-none"
    >
      <span className="block w-full h-full rounded-full bg-contradiction shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-contradiction)_22%,transparent)] animate-attention-pulse" />
    </span>
  );
}
