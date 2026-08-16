"use client";

import { useState } from "react";
import { OnboardingDot } from "./Onboarding";

/**
 * The three kinds of difference, and the band each one wears.
 *
 * Shown twice: in the controls strip above a comparison, where it is a key to
 * marks already on screen, and on the landing page, where it is a promise about
 * marks the reader has not seen yet. Same swatches either way — the landing
 * page teaching one vocabulary and the article using another would be worse
 * than not teaching it at all.
 *
 * In the strip the key is also a control: three two-word labels are not the
 * whole explanation, so pressing it opens the described version. On a first
 * article the onboarding dot sits on it and offers the same thing, because a
 * reader who does not know what the colours mean cannot read the page at all.
 */

const KINDS = [
  ["contradiction", "bg-mark-contradiction inset-shadow-contradiction", "contradiction", "The versions state facts that cannot both be true."],
  ["unique", "bg-mark-unique inset-shadow-unique", "only in one version", "Material one language covers and the others skip entirely."],
  ["framing", "bg-mark-framing inset-shadow-framing", "different framing", "The same fact, told in words that carry a different claim."],
] as const;

function Described() {
  return (
    <dl className="legend-full grid grid-cols-3 gap-[22px] m-0 max-cols:grid-cols-1 max-cols:gap-[16px]">
      {KINDS.map(([key, swatch, label, note]) => (
        <div key={key} className="min-w-0">
          <dt className="flex items-center gap-[8px] font-mono text-[12px] tracking-[0.04em] text-ink">
            <i className={`inline-block w-[15px] h-[15px] rounded-[2px] shrink-0 ${swatch}`} />
            {label}
          </dt>
          <dd className="m-0 mt-[6px] text-[14px] leading-[1.6] text-ink-soft">{note}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function Legend({
  describe = false,
  hint = false,
  onHintDone,
}: {
  describe?: boolean;
  /** Whether the key is the feature the onboarding dot is currently on. */
  hint?: boolean;
  /** Fired when the panel is dismissed while the dot is here, which is what
   *  moves the dot on. Dismissing it any other time is just a closed panel. */
  onHintDone?: () => void;
}) {
  /** Whether the panel spelling the three kinds out is open. */
  const [open, setOpen] = useState(false);

  function close(): void {
    setOpen(false);
    if (hint) onHintDone?.();
  }

  if (describe) return <Described />;

  return (
    // The wrapper carries the strip-level sizing and is what the panel is
    // anchored to; `.legend` inside it stays the key itself, so it can be a
    // button without a `<dl>` ending up inside one.
    //
    // A column beside the length chart on a phone, rather than a row under it.
    // Set as a row there the three kinds wrap onto two ragged lines and push
    // the strip down a third one, all while the space to the chart's right sits
    // empty — which is exactly where a key to the chart wants to be anyway.
    //
    // `basis-0` rather than letting the strip wrap it there: a legend that
    // drops below the chart the moment it stops fitting costs a line of height
    // on the narrowest screens, which are the ones that can least afford one.
    // Sized from zero it never pushes itself onto a line of its own, and
    // `min-w-fit` then claims back exactly the width its longest label needs —
    // so the leftover goes to the chart, which is the half of the strip that
    // can actually use it, and neither of them wraps down to 320px.
    <div className="legend-key relative max-tight:min-w-fit max-tight:flex-1 max-tight:basis-0">
      {hint && !open && (
        <OnboardingDot reveal={() => setOpen(true)} label="What the marks mean" />
      )}
      {/* Labels in ink rather than the strip's soft grey, and the swatches
          carry the same band the marks in the prose do: the one thing a reader
          has to read before the columns mean anything should not be the palest
          line above them. Underlined on hover and focus, so it also looks like
          what it now is. */}
      <button
        type="button"
        className="legend flex flex-wrap gap-[16px] max-cols:gap-x-[12px] max-cols:gap-y-[6px] text-start text-ink max-tight:flex-col max-tight:flex-nowrap max-tight:gap-y-[8px] cursor-help hover:underline focus-visible:underline decoration-rule underline-offset-[3px]"
        aria-expanded={open}
        aria-controls="legend-note"
        onClick={() => (open ? close() : setOpen(true))}
      >
        {KINDS.map(([key, swatch, label]) => (
          <span key={key} className="flex items-center gap-[6px]">
            <i className={`swatch ${key} inline-block w-[15px] h-[15px] rounded-[2px] ${swatch}`} />{" "}
            {label}
          </span>
        ))}
      </button>

      {/* Printed on raised paper with the offset shadow every live panel here
          wears, so on a first article it reads as something opened rather than
          as more strip. Not a tooltip: it holds a button, and it stays until it
          is dismissed.
          `role="status"` because the dot that opens it on a first article is
          not what a reader was reading, so it is announced where it stands
          instead of waiting for focus to arrive. Anchored to the right edge on
          a phone, where the key sits against it and a panel starting at the
          key's own left edge would run off screen. */}
      {open && (
        <div
          id="legend-note"
          role="status"
          className="legend-note absolute z-50 top-[calc(100%_+_10px)] start-0 max-tight:start-auto max-tight:end-0 w-[min(620px,calc(100vw_-_44px))] max-cols:w-[min(320px,calc(100vw_-_36px))] px-[15px] pt-[12px] pb-[14px] bg-paper-raised border border-ink rounded-[2px] shadow-offset font-body normal-case tracking-normal text-ink animate-reveal-in"
        >
          <p className="m-0 mb-[12px] font-mono text-[11px] tracking-[0.09em] uppercase text-ink-soft">
            what the marks mean
          </p>
          <Described />
          <button
            type="button"
            className="legend-note-ok mt-[13px] py-[6px] px-[14px] font-mono text-[12px] tracking-[0.04em] bg-ink text-paper-raised border border-ink transition-opacity duration-[120ms] ease-[ease] hover:opacity-[0.82]"
            onClick={close}
          >
            Got it
          </button>
        </div>
      )}
    </div>
  );
}
