"use client";

import { PRICE_PER_ARTICLE_CENTS, formatCents } from "@/lib/pricing";

/**
 * The seam between what has been read and what hasn't.
 *
 * It spans all three columns rather than sitting inside one, because the thing
 * being announced is a property of the comparison, not of any single edition —
 * and because three separate notices at three different heights would read as
 * three faults rather than one boundary.
 *
 * The copy leads with what the reader gets rather than what they are missing.
 * Funding this does not buy the donor a private article; it buys the article for
 * whoever opens it next, and that is the whole argument for paying at all, so it
 * is the sentence that has to land.
 */
export default function PreviewGate({
  busy,
  signedIn,
  creditCents,
  onFund,
  onDonate,
  error,
}: {
  busy: boolean;
  signedIn: boolean;
  creditCents: number;
  onFund: () => void;
  onDonate: () => void;
  error?: string | null;
}) {
  const affordable = creditCents >= PRICE_PER_ARTICLE_CENTS;
  const canFund = signedIn && affordable;

  return (
    // Raised paper, ruled top and bottom, no shadow and no accent colour: this
    // is the point where the article stops being compared, stated plainly,
    // not a panel selling something.
    <div
      className="gate border-t border-b border-rule bg-paper-raised px-[24px] pt-[34px] pb-[32px] text-center max-tight:px-[18px] max-tight:pt-[26px] max-tight:pb-[24px]"
    >
      <h2 className="mb-[6px] font-display text-[27px] font-normal max-tight:text-[23px]">
        The rest of this article hasn&apos;t been processed yet
      </h2>
      <p className="mx-auto mb-[18px] max-w-[56ch] text-[14px] text-ink-soft">
        Each article costs about{" "}{formatCents(PRICE_PER_ARTICLE_CENTS)} to process. 
        <br />
        Once it&apos;s done it becomes available for everyone.
      </p>
      {canFund ? (
        <button
          className="gate-cta border border-ink bg-ink px-[22px] py-[10px] text-paper-raised disabled:cursor-progress disabled:opacity-45"
          onClick={onFund}
          disabled={busy}
        >
          {busy ? "Reading the rest…" : "Process the rest of this article"}
        </button>
      ) : (
        <button
          className="gate-cta border border-ink bg-ink px-[22px] py-[10px] text-paper-raised disabled:cursor-progress disabled:opacity-45"
          onClick={onDonate}
          disabled={busy}
        >
          {signedIn ? "Add credit to process this" : "Donate to process this"}
        </button>
      )}
      {signedIn && !affordable && (
        <p className="gate-note mt-[12px] font-mono text-[11px] text-ink-soft">
          You have {formatCents(creditCents)} left — an article costs{" "}
          {formatCents(PRICE_PER_ARTICLE_CENTS)}.
        </p>
      )}
      {error && <p className="gate-note gate-error mt-[12px] font-mono text-[11px] text-ink-soft">{error}</p>}
    </div>
  );
}
