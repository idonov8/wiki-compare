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
    <div className="preview-cta-group flex items-center gap-x-[10px]">
      <button
        type="button"
        className="preview-cta border border-ink bg-ink px-[12px] py-[5px] font-body text-[13px] text-paper-raised disabled:cursor-progress disabled:opacity-45"
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
          copy sits in a slim row rather than a standalone panel. */}
      <p className="preview-cta-note font-mono text-[11px] leading-[1.6] text-ink-soft">
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
