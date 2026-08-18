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
 * past is explicit: the CTA, the quiet "Not now", or Escape.
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
      <div className="w-full max-w-[460px] bg-paper-raised border border-ink rounded-[2px] shadow-offset px-[30px] pt-[26px] pb-[26px] max-tight:px-[20px] animate-reveal-in">
        <p className="m-0 mb-[10px] font-mono text-[11px] tracking-[0.09em] uppercase text-ink-soft">
          Welcome — how credit works
        </p>
        <h2 id="credits-modal-title" className="font-display text-[27px] font-normal leading-[1.2] m-0 mb-[12px] max-tight:text-[23px]">
          Your account holds {formatCents(creditCents)} — about {articles}{" "}
          {articles === 1 ? "article" : "articles"}
        </h2>
        <p className="credits-modal-text m-0 mb-[20px] font-body text-[14px] leading-[1.6] text-ink">
          Processing an article has AI read all three language versions and mark
          every difference between them. It spends ~
          {formatCents(PRICE_PER_ARTICLE_CENTS)} of your credit, and the result
          stays readable for <b>everyone</b> who opens it after you — that is
          what your credit buys.
        </p>
        <div className="flex items-center gap-[14px] flex-wrap">
          <button
            type="button"
            ref={ctaRef}
            className="credits-modal-cta py-[10px] px-[22px] font-mono text-[12px] tracking-[0.04em] bg-ink text-paper-raised border border-ink transition-opacity duration-[120ms] ease-[ease] hover:opacity-[0.82]"
            onClick={onProcess}
          >
            {processed ? "Read this article" : "Process this article"}
          </button>
          <button
            type="button"
            className="credits-modal-later py-[10px] px-[8px] font-mono text-[12px] tracking-[0.04em] bg-transparent text-ink-soft border-none underline underline-offset-[3px] hover:text-ink"
            onClick={onDismiss}
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
