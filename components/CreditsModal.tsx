"use client";

import { useEffect, useRef } from "react";
import { PRICE_PER_ARTICLE_CENTS, SIGNUP_GRANT_CENTS, articlesFor, formatCents } from "@/lib/pricing";

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
 *
 * The card reads top to bottom as gift, then terms, then act: a ribbon in the
 * site's own three diff colours (the one thing this brand gets to have — see
 * `Wordmark`) stands in for a bow, the lead line and the figures inside it are
 * what a skimming reader needs, the second paragraph is the fine print for
 * anyone who reads on, and a rule sets the button apart as the one thing left
 * to do. None of that changes what the copy says — only how it's found.
 */
export default function CreditsModal({
  creditCents,
  onProcess,
  onDismiss,
}: {
  creditCents: number;
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
  // The grant is always a whole number of dollars — "$1.00" is precision the
  // sentence doesn't need, unlike the footnote below, which is pricing an
  // actual spend down to the cent.
  const grant = `$${Math.trunc(SIGNUP_GRANT_CENTS / 100)}`;

  return (
    <div
      className="credits-modal fixed inset-0 z-[60] grid place-items-center p-[20px] bg-[color-mix(in_srgb,var(--color-ink)_44%,transparent)]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="credits-modal-title"
    >
      <div className="relative w-full max-w-[560px] overflow-hidden bg-paper-raised border border-ink rounded-[2px] shadow-offset animate-reveal-in">
        {/* The one glyph this brand gets — see `Wordmark` — laid flat across
            the top edge like a ribbon on a gift, rather than redrawn as an
            icon. Decorative only: the modal is already labelled by the
            heading below. */}
        <div className="flex h-[7px]" aria-hidden="true">
          <span className="flex-1 bg-contradiction" />
          <span className="flex-1 bg-unique" />
          <span className="flex-1 bg-framing" />
        </div>

        <div className="px-[42px] pt-[34px] pb-[36px] max-tight:px-[24px]">
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Not now"
            className="credits-modal-later absolute top-[19px] right-[16px] grid h-[32px] w-[32px] place-items-center rounded-full border border-transparent bg-transparent font-mono text-[19px] leading-none text-ink-soft transition-colors duration-150 ease-[ease] hover:border-rule hover:bg-ink-wash hover:text-ink"
          >
            ×
          </button>

          <h2
            id="credits-modal-title"
            className="font-display text-[38px] font-normal leading-[1.15] m-0 mb-[18px] max-w-[16ch] max-tight:text-[30px] animate-reveal-in"
            style={{ animationDelay: "60ms" }}
          >
            Welcome, you got {grant}!
          </h2>

          <div
            className="credits-modal-text font-body text-ink animate-reveal-in"
            style={{ animationDelay: "110ms" }}
          >
            {/* The lead: what happened and what it buys. Kept at full ink and
                a touch larger than the fine print below it, with the two
                figures a skim lands on set in the mono the rest of the site
                already reserves for amounts (`CreditBar`, the meta strip) —
                so the grant and the article count read as data inside the
                sentence, not just words in it. */}
            <p className="m-0 text-[19px] leading-[1.65]">
              Wiki Compare uses a credit system.
              <br />
              As a welcome gift, you get{" "}
              <b className="font-mono font-semibold tracking-[-0.01em]">{grant}</b>{" "}
              of credits, which is enough for{" "}
              <b className="font-mono font-semibold tracking-[-0.01em]">
                {articles} article{articles !== 1 ? "s" : ""}
              </b>
              .
            </p>
            <p className="m-0 mt-[16px] text-[16px] leading-[1.65] text-ink-soft">
              The result becomes readable for{" "} <b className="text-ink">everyone</b>.
              <br/> By using your credit you make Wiki Compare more
              accessible and better for everyone. Thanks!
            </p>
          </div>

          {/* The rule marks where reading ends and the one thing left to do
              begins — the same separation `PreviewGate` draws with a border
              around its whole panel, drawn here as a line instead since the
              panel above is prose, not a distinct surface. */}
          <div
            className="mt-[28px] pt-[28px] border-t border-rule text-center animate-reveal-in"
            style={{ animationDelay: "160ms" }}
          >
            <button
              type="button"
              ref={ctaRef}
              className="credits-modal-cta border border-ink bg-ink px-[32px] py-[15px] text-[17px] text-paper-raised transition-transform duration-150 ease-[ease] hover:enabled:-translate-y-[1px] disabled:cursor-progress disabled:opacity-45"
              onClick={onProcess}
            >
              Donate this article
            </button>

            {/* What pressing it means, under the button rather than in it — same
                pairing as the gate's donate button. */}
            <p className="credits-modal-note mt-[15px] font-mono text-[13px] leading-[1.6] text-ink-soft">
              This spends ~{formatCents(PRICE_PER_ARTICLE_CENTS)} of your {formatCents(creditCents)} credit
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
