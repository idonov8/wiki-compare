"use client";

import { useEffect, useRef } from "react";
import { PRICE_PER_ARTICLE_CENTS, articlesFor, formatCents } from "@/lib/pricing";

/** Whether this device has been shown the credit explainer. Kept apart from the
 *  onboarding cursor: the dots teach the page, this explains the account, and
 *  the two arrive at different moments. */
const SEEN = "wiki-compare:credits-explained";

export function creditsExplained(): boolean {
  try {
    return localStorage.getItem(SEEN) === "1";
  } catch {
    // Storage denied (private mode): claim unseen, so it still shows once.
    return false;
  }
}

export function markCreditsExplained(): void {
  try {
    localStorage.setItem(SEEN, "1");
  } catch {}
}

/**
 * The credit system, explained once, over the first article a new account opens.
 *
 * This replaced a small note beside the credit meter that opened on hover — a
 * placement that explained the one mechanism the whole site runs on only to
 * readers who happened to point at a 3px bar. It appears over the first article
 * because that is the moment the explanation is actionable: the primary button
 * spends the credit it has just described, on the page under it.
 *
 * The backdrop takes no click. The reader chose an article and this stands on
 * top of it, so it owes them a way past — but a scrim that dismisses on a stray
 * press would be the old hover note again, gone before it was read. The way
 * past is explicit: the CTA, the close button, or Escape.
 */
export default function CreditsModal({
  creditCents,
  processed,
  onProcess,
  onDismiss,
}: {
  creditCents: number;
  /** Whether the article underneath is already fully processed, in which case
   *  there is nothing to buy and the button just puts the modal away. */
  processed: boolean;
  onProcess: () => void;
  onDismiss: () => void;
}) {
  const ctaRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    ctaRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const articles = articlesFor(creditCents);

  return (
    <div
      className="credits-modal fixed inset-0 z-[60] grid place-items-center p-[20px] bg-[color-mix(in_srgb,var(--color-ink)_44%,transparent)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="credits-modal-title"
    >
      <div className="relative w-full max-w-[460px] bg-paper-raised border border-ink rounded-[2px] shadow-offset px-[30px] pt-[26px] pb-[26px] max-tight:px-[20px] animate-reveal-in">
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Not now"
          className="credits-modal-later absolute top-[12px] right-[12px] bg-transparent border-none px-[6px] font-mono text-[15px] leading-none text-ink-soft hover:text-ink"
        >
          ×
        </button>
        <h2 id="credits-modal-title" className="font-display text-[27px] font-normal leading-[1.2] m-0 mb-[12px] max-tight:text-[23px]">
          Welcome, you got 1$!
        </h2>
        <p className="credits-modal-text m-0 mb-[20px] font-body text-[14px] leading-[1.6] text-ink">
          Wiki Compare uses a credit system.
          <br/>
          As a welcome gift, you got 1$ of credits, which is enough for {articles} article{articles !== 1 ? "s" : ""}.
          <br/><br/>
          Each article costs a few cents of your credit, and the result stays readable for <b>everyone</b>.
          By using your credit you make Wiki Compare more accessible and better for everyone. Thanks!
        </p>
        <div className="text-center">
          <button
            type="button"
            ref={ctaRef}
            className="credits-modal-cta border border-ink bg-ink px-[22px] py-[10px] text-paper-raised disabled:cursor-progress disabled:opacity-45"
            onClick={onProcess}
          >
            {processed ? "Read this article" : "Donate this article"}
          </button>

          {/* What pressing it means, under the button rather than in it — same
              pairing as the gate's donate button. */}
          {!processed && (
            <p className="credits-modal-note mt-[12px] font-mono text-[11px] leading-[1.6] text-ink-soft">
              This spends ~{formatCents(PRICE_PER_ARTICLE_CENTS)} of your {formatCents(creditCents)} credit
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
