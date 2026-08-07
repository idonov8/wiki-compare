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
    <div className="gate">
      <h2>The rest of this article hasn&apos;t been compared yet</h2>
      <p>
        Everything above has been read in all three languages. Processing the rest costs about{" "}
        {formatCents(PRICE_PER_ARTICLE_CENTS)} in tokens — and once it&apos;s done it stays done,
        for everyone who opens this page after you.
      </p>
      {canFund ? (
        <button className="gate-cta" onClick={onFund} disabled={busy}>
          {busy ? "Reading the rest…" : "Process the rest of this article"}
        </button>
      ) : (
        <button className="gate-cta" onClick={onDonate} disabled={busy}>
          {signedIn ? "Add credit to process this" : "Donate to process this"}
        </button>
      )}
      {signedIn && !affordable && (
        <p className="gate-note">
          You have {formatCents(creditCents)} left — an article costs{" "}
          {formatCents(PRICE_PER_ARTICLE_CENTS)}.
        </p>
      )}
      {error && <p className="gate-note gate-error">{error}</p>}
    </div>
  );
}
