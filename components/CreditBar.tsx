"use client";

import { useEffect, useState } from "react";
import { articlesFor, formatCents } from "@/lib/pricing";
import { authClient } from "@/lib/auth-client";
import { track } from "@/lib/analytics";
import type { MeResponse } from "@/lib/types";

/**
 * That the welcome note has been read. Kept on the device rather than on the
 * account: it is a note that has been dismissed, not a fact about the balance,
 * and a column for it would be a schema change to remember one click.
 */
const WELCOME_SEEN = "wiki-compare:welcome-seen";

/**
 * What the reader has left, and what they have already given.
 *
 * Signed out this is one small "Log in" button and nothing else. It used to say
 * "Donate", which asked for money from somebody the site could not yet attach
 * any to — an account has to exist before credit can live on it, and an account
 * now arrives with five articles in it, so logging in is both the first step and
 * usually the only one.
 *
 * Signed in, the resting state carries both halves of the same figure — what is
 * left, and what has been spent — because the meter's empty portion is literally
 * the money that has funded somebody else's reading. A balance alone says only
 * what you still hold.
 *
 * The detail panel is a popover rather than a tooltip: it contains a button, and
 * a tooltip may not. It stays open while the pointer is inside it (the panel is
 * a DOM child of the container, so `:hover` on the container survives the trip,
 * and a bridge element covers the 8px gap) and while anything in it has focus.
 *
 * The thank-you is the reason this exists at all. It names two numbers — what
 * they processed, and how many people have read it since — because a donation
 * here does not buy the donor anything they could not otherwise have. It buys
 * other people's reading, and the only honest way to thank somebody for that is
 * to say how much of it there has been.
 *
 * The welcome note is the one panel here that opens itself. A meter that fills
 * in on its own the first time somebody signs in is a number with no sentence
 * attached, and the sentence — five articles, already yours, spend them on
 * anything — is the whole reason the number is there.
 */
export default function CreditBar({
  me,
  onDonate,
  onLogIn,
}: {
  me: MeResponse | null;
  onDonate: () => void;
  onLogIn: () => void;
}) {
  /** Whether the welcome note has already been dismissed on this device. Starts
   *  true so the note cannot flash on screen during hydration and then vanish;
   *  the effect below is what lets it through. */
  const [welcomeSeen, setWelcomeSeen] = useState(true);

  useEffect(() => {
    try {
      setWelcomeSeen(localStorage.getItem(WELCOME_SEEN) === "1");
    } catch {
      // Storage can be denied outright (private mode, a locked-down browser).
      // The note is worth showing once even where the dismissal cannot stick,
      // but not worth an exception on every page load.
      setWelcomeSeen(false);
    }
  }, []);

  function dismissWelcome(): void {
    setWelcomeSeen(true);
    try {
      localStorage.setItem(WELCOME_SEEN, "1");
    } catch {}
  }

  /**
   * Signs out and reloads. Better Auth's `signOut` clears the session cookie on
   * the server; the reload re-runs `/api/me` so the masthead drops back to the
   * signed-out Donate button without the parent having to thread a refresh
   * callback down here. A failure is logged but not surfaced as UI: the panel is
   * a popover that closes on the next pointer move, and an error toast here would
   * race that and lose.
   */
  async function signOut(): Promise<void> {
    track("logout_clicked");
    const { error } = await authClient.signOut();
    if (error) {
      console.error("[CreditBar] sign out failed", error);
      return;
    }
    window.location.reload();
  }

  if (!me) {
    return (
      // Outlined rather than filled so the filled Search button keeps the
      // masthead's only solid block of ink, and inverts on hover so it is
      // unmistakably live.
      <button
        type="button"
        className="credit-cta flex-none py-[7px] px-[15px] font-mono text-[12px] tracking-[0.04em] bg-paper-raised text-ink border border-ink transition-[background,color] duration-[120ms] ease-[ease] hover:bg-ink hover:text-paper-raised"
        onClick={onLogIn}
      >
        Log in
      </button>
    );
  }

  const remaining = articlesFor(me.creditCents);
  /** The note beside the meter, on until it is read. `newcomer` is the server's
   *  word for "this balance is still the sign-up grant, untouched". */
  const welcome = me.newcomer && !welcomeSeen;
  // Never divide by a zero peak: a brand-new account has held nothing, and an
  // empty meter is the honest picture of an empty balance.
  const fill = me.peakCreditCents > 0 ? Math.min(1, me.creditCents / me.peakCreditCents) : 0;
  // What has gone out is the gap between the most this account ever held and
  // what it holds now — the unfilled part of the meter, in words.
  const used = Math.max(0, me.peakCreditCents - me.creditCents);

  return (
    // `group` drives the detail panel below: it opens on hover or focus of this
    // container, not of the panel itself.
    <div
      className="credit group relative flex flex-col gap-[5px] min-w-[148px] max-cols:min-w-0 max-cols:flex-[1_1_100%] font-mono text-[11px] text-ink-soft cursor-help"
      tabIndex={0}
      aria-describedby={welcome ? "credit-welcome-text" : "credit-detail-text"}
    >
      {/* Proportion of the account's own peak, not of some notional full tank:
          the denominator is the most this person ever held, so the bar empties
          against what they gave rather than against a number we invented. */}
      <span
        className="credit-meter h-[3px] rounded-[2px] bg-ink-track overflow-hidden"
        aria-hidden="true"
      >
        <span
          className="credit-fill block h-full rounded-[2px] bg-ink transition-[width] duration-[240ms] ease-[ease]"
          style={{ width: `${(fill * 100).toFixed(1)}%` }}
        />
      </span>
      <span className="credit-balance tracking-[0.04em] whitespace-nowrap text-ink">
        <b className="font-semibold">{formatCents(me.creditCents)}</b> left{" "}
        <span className="text-ink-soft">· {formatCents(used)} used</span>
      </span>

      {/* The welcome note: the same anchor as the detail panel below, but open
          on arrival rather than on hover, because nobody hovers a meter they
          have not yet been given a reason to look at. It takes that anchor
          exclusively — two panels stacked at one corner is one panel covering
          another — so the hover panel is switched off for as long as this is up,
          which is until it is dismissed or until the credit has been used.

          `role="status"`: it appears without anybody asking for it, so it is
          announced where it stands rather than waiting for focus to arrive. */}
      {welcome && (
        <div
          className="credit-welcome absolute z-50 top-[calc(100%_+_8px)] end-0 max-cols:end-auto max-cols:start-0 w-[300px] max-cols:w-[min(300px,calc(100vw_-_48px))] pt-[11px] px-[13px] pb-[12px] bg-paper-raised border border-ink rounded-[2px] shadow-offset font-body text-[13px] leading-[1.55] tracking-normal normal-case text-start text-ink cursor-default animate-reveal-in"
          role="status"
        >
          <p className="credit-welcome-text m-0" id="credit-welcome-text">
            Welcome — there&apos;s {formatCents(me.creditCents)} on your account, enough for{" "}
            {remaining} {remaining === 1 ? "article" : "articles"}. Open one and press{" "}
            <b className="font-semibold">Donate this article</b> at the end of the preview: it
            spends your credit to process the rest, and it stays readable for everyone who comes
            after you.
          </p>
          <button
            type="button"
            className="credit-welcome-ok mt-[11px] py-[6px] px-[14px] font-mono text-[12px] tracking-[0.04em] bg-ink text-paper-raised border border-ink transition-opacity duration-[120ms] ease-[ease] hover:opacity-[0.82]"
            onClick={dismissWelcome}
          >
            Got it
          </button>
        </div>
      )}

      {/* The panel. Anchored under the control at the top of the page, so it
          cannot be pushed off the bottom of the viewport — but it holds a
          button, so it takes pointer events when it is open and it is not
          announced as a tooltip.

          `group-focus-within`, not `group-focus-visible`: the container itself
          is focusable, so Tab opens the panel, and the next Tab reaches the
          button inside it — which is only focusable because the panel is
          visible by then.

          `visibility`/`opacity`/`pointer-events` (not `display`) so the panel
          can transition and so a Playwright suite can read
          `getComputedStyle(el).visibility` directly. */}
      <div
        className={`credit-detail absolute z-50 top-[calc(100%_+_8px)] end-0 max-cols:end-auto max-cols:start-0 w-[300px] max-cols:w-[min(300px,calc(100vw_-_48px))] pt-[11px] px-[13px] pb-[12px] bg-paper-raised border border-ink rounded-[2px] shadow-offset font-body text-[13px] leading-[1.55] tracking-normal normal-case text-start text-ink cursor-default invisible opacity-0 pointer-events-none transition-opacity duration-[120ms] ease-[ease] group-hover:visible group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:visible group-focus-within:opacity-100 group-focus-within:pointer-events-auto before:content-[''] before:absolute before:-inset-x-px before:-top-[10px] before:h-[10px] ${
          // `display: none` beats every visibility utility above, which is what
          // keeps the welcome note from being opened into on hover.
          welcome ? "hidden" : ""
        }`}
      >
        {/* The trip from the figures down to the panel crosses 8px of nothing,
            and a pointer over nothing is a pointer that has left `.credit` —
            the panel would shut under the cursor on its way to the button.
            The `before:` pseudo-element bridges that gap. It is part of the
            panel, so it is inert until the panel is open. A Playwright test
            walks the mouse from the badge to the button in twelve steps
            specifically to catch this regressing. */}
        <p className="credit-detail-text m-0" id="credit-detail-text">
          {formatCents(me.creditCents)} / ~{remaining} {" "}
          {remaining === 1 ? "article" : "articles"} left.
          {me.articlesProcessed > 0 ? (
            <>
              {" "}
              You&apos;ve processed {me.articlesProcessed}{" "}
              {me.articlesProcessed === 1 ? "article" : "articles"}, and{" "}
              {me.readsOfThoseArticles === 0
                ? "they're waiting for their first reader"
                : `they've been read ${me.readsOfThoseArticles} ${
                    me.readsOfThoseArticles === 1 ? "time" : "times"
                  } since`}
              . Thank you for making this better for everyone.
            </>
          ) : (
            <> Open an article to make it available for everyone.</>
          )}
        </p>
        <div className="credit-detail-actions flex gap-[8px] mt-[11px]">
          <button
            type="button"
            className="credit-detail-cta block mt-0 py-[6px] px-[14px] font-mono text-[12px] tracking-[0.04em] bg-ink text-paper-raised border border-ink transition-opacity duration-[120ms] ease-[ease] hover:opacity-[0.82]"
            onClick={onDonate}
          >
            Donate
          </button>
          {/* No fill, just the ink outline, so the action that funds reading
              stays the visual primary and the one that leaves stays
              secondary. */}
          <button
            type="button"
            className="credit-detail-signout py-[6px] px-[14px] font-mono text-[12px] tracking-[0.04em] bg-transparent text-ink border border-ink transition-opacity duration-[120ms] ease-[ease] hover:opacity-[0.82]"
            onClick={signOut}
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  );
}
