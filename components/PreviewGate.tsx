"use client";

import Outage from "./Outage";
import { PRICE_PER_ARTICLE_CENTS, SIGNUP_GRANT_CENTS, articlesFor, formatCents } from "@/lib/pricing";
import { OUT_OF_CREDIT } from "@/lib/types";

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
 *
 * Three states, and each one asks for exactly the next thing:
 *
 *  - signed out: log in. Not "donate" — there is nothing to attach a donation
 *    to yet, and an account arrives with five articles in it, so for most people
 *    this is the only step there ever is.
 *  - signed in with credit: donate this article, and a line saying what that
 *    spends and what it buys, since the credit is the reader's and spending it
 *    should never be a surprise.
 *  - signed in with nothing left: top up. The one case where the ask really is
 *    money, and the only one that goes to the payment page.
 */
export default function PreviewGate({
  busy,
  signedIn,
  creditCents,
  onFund,
  onLogIn,
  onTopUp,
  error,
}: {
  busy: boolean;
  signedIn: boolean;
  creditCents: number;
  onFund: () => void;
  onLogIn: () => void;
  onTopUp: () => void;
  error?: string | null;
}) {
  const affordable = creditCents >= PRICE_PER_ARTICLE_CENTS;
  const canFund = signedIn && affordable;

  // Pressing the button gave the reader's credit back and read nothing, because
  // the site itself cannot pay the model. Offering the button again below that
  // sentence would only be inviting them to watch it fail a second time.
  if (error === OUT_OF_CREDIT) {
    return (
      <div className="gate border-t border-b border-rule bg-paper-raised px-[24px] py-[8px] max-tight:px-[18px]">
        <Outage from="preview-gate-outage" />
      </div>
    );
  }

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
      <button
        className="gate-cta border border-ink bg-ink px-[22px] py-[10px] text-paper-raised disabled:cursor-progress disabled:opacity-45"
        onClick={canFund ? onFund : signedIn ? onTopUp : onLogIn}
        disabled={busy}
      >
        {busy
          ? "Reading the rest…"
          : canFund
            ? "Donate this article"
            : signedIn
              ? "Top up credit to donate this article"
              : "Log in to process this article"}
      </button>

      {/* What pressing it means, under the button rather than in it. The button
          says the act; this says the cost and who gets it. */}
      <p className="gate-note mt-[12px] font-mono text-[11px] leading-[1.6] text-ink-soft">
        {canFund ? (
          <>
            This spends ~{formatCents(PRICE_PER_ARTICLE_CENTS)} of your{" "}
            {formatCents(creditCents)} credit
          </>
        ) : signedIn ? (
          <>
            You can find processed articles in the <a href="/?full=true#recently-compared" className="text-ink">home page</a>.
          </>
        ) : (
          <>
            Get {articlesFor(SIGNUP_GRANT_CENTS)} articles for free
          </>
        )}
      </p>
      {error && <p className="gate-note gate-error mt-[12px] font-mono text-[11px] text-ink-soft">{error}</p>}
    </div>
  );
}
