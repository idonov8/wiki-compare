"use client";

/**
 * Five seconds of thanks, over whatever the reader is doing.
 *
 * Raised the moment a donation is spent rather than when the run finishes: the
 * model takes about a minute, and a thank-you that arrived then would be
 * thanking somebody for waiting. This one answers the press.
 *
 * Fixed to the top of the viewport, centred. The bottom of the screen is spoken
 * for on a phone — the language switch and the difference stepper both live
 * there — and this must never land on a control. It takes no pointer events for
 * the same reason: it is a sentence, not a dialog, and it should not be able to
 * swallow a click meant for the page underneath.
 */
export default function ThankYou() {
  return (
    <div
      className="thanks fixed z-[100] top-[18px] left-1/2 -translate-x-1/2 w-[max-content] max-w-[min(420px,calc(100vw_-_32px))] px-[18px] py-[13px] bg-paper-raised border border-ink rounded-[2px] shadow-offset text-center pointer-events-none animate-reveal-in"
      role="status"
    >
      <strong className="thanks-title block font-display text-[22px] font-normal leading-[1.2]">
        Thank you
      </strong>
      <span className="thanks-note mt-[4px] block font-mono text-[11px] leading-[1.55] tracking-[0.04em] text-ink-soft">
        Reading the rest of it now. It stays open for everyone.
      </span>
    </div>
  );
}
