"use client";

import { PRICE_PER_ARTICLE_CENTS, formatCents } from "@/lib/pricing";

/**
 * The offer to finish reading a previewed article.
 *
 * Three states, the same three the seam's gate offers: read it now, top up
 * first, or log in — an account arrives with credit in it, so for most people
 * logging in is the only step there ever is. Styled to match the gate's
 * button and carry the same note underneath it, since this is the same offer
 * made again, higher up the page.
 */
export default function PreviewCta({
  busy,
  signedIn,
  canFund,
  creditCents,
  onFund,
  onTopUp,
  onLogIn,
}: {
  busy: boolean;
  signedIn: boolean;
  canFund: boolean;
  creditCents: number;
  onFund: () => void;
  onTopUp: () => void;
  onLogIn: () => void;
}) {
  return (
    <div className="preview-cta-group flex min-w-0 items-center gap-x-[10px] max-tight:gap-x-[8px]">
      <button
        type="button"
        className="preview-cta shrink-0 border border-ink bg-ink px-[12px] py-[5px] max-tight:px-[9px] max-tight:py-[4px] font-body text-[13px] max-tight:text-[11px] text-paper-raised disabled:cursor-progress disabled:opacity-45"
        disabled={busy}
        onClick={canFund ? onFund : signedIn ? onTopUp : onLogIn}
      >
        {busy
          ? "Reading the rest…"
          : canFund
            ? "Donate this article"
            : signedIn
              ? "Top up to donate it"
              : "Log in to process it"}
      </button>

      {/* What pressing it means, beside the button rather than in it, same as
          the gate below — just alongside instead of underneath, since this
          copy sits in a slim row rather than a standalone panel. Free text
          rather than a fixed label, so on a phone it gets a bounded box and
          an ellipsis instead of pushing the strip onto a second line. */}
      <p className="preview-cta-note min-w-0 font-mono text-[11px] leading-[1.6] text-ink-soft max-tight:truncate max-tight:text-[10px]">
        {canFund ? (
          <>
            This spends ~{formatCents(PRICE_PER_ARTICLE_CENTS)} of your{" "}
            {formatCents(creditCents)} credit
          </>
        ) : (
          "We use AI to find the gaps"
        )}
      </p>
    </div>
  );
}
