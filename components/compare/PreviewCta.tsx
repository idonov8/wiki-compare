"use client";

/**
 * The offer to finish reading a previewed article.
 *
 * Three states, the same three the seam's gate offers: read it now, top up
 * first, or log in — an account arrives with credit in it, so for most people
 * logging in is the only step there ever is.
 */
export default function PreviewCta({
  busy,
  signedIn,
  canFund,
  onFund,
  onTopUp,
  onLogIn,
}: {
  busy: boolean;
  signedIn: boolean;
  canFund: boolean;
  onFund: () => void;
  onTopUp: () => void;
  onLogIn: () => void;
}) {
  return (
    <button
      type="button"
      className="preview-cta border border-ink px-[12px] py-[5px] font-mono text-[11px] tracking-[0.07em] uppercase text-ink transition-colors duration-[120ms] ease-[ease] hover:enabled:bg-ink hover:enabled:text-paper-raised disabled:opacity-45 disabled:cursor-progress"
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
  );
}
