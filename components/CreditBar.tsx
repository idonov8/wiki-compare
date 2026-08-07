"use client";

import { articlesFor, formatCents } from "@/lib/pricing";
import type { MeResponse } from "@/lib/types";

/**
 * What the reader has left, and what they have already given.
 *
 * Signed out this is one small "Donate" button and nothing else. Signing in is
 * the first step of the donate flow now, so the masthead has no form in it: an
 * email field beside the search field asked the visitor to tell two boxes apart
 * before they had a reason to care about either.
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
 */
export default function CreditBar({ me, onDonate }: { me: MeResponse | null; onDonate: () => void }) {
  if (!me) {
    return (
      <button type="button" className="credit-cta" onClick={onDonate}>
        Donate
      </button>
    );
  }

  const remaining = articlesFor(me.creditCents);
  // Never divide by a zero peak: a brand-new account has held nothing, and an
  // empty meter is the honest picture of an empty balance.
  const fill = me.peakCreditCents > 0 ? Math.min(1, me.creditCents / me.peakCreditCents) : 0;
  // What has gone out is the gap between the most this account ever held and
  // what it holds now — the unfilled part of the meter, in words.
  const used = Math.max(0, me.peakCreditCents - me.creditCents);

  return (
    <div className="credit" tabIndex={0} aria-describedby="credit-detail-text">
      <span className="credit-meter" aria-hidden="true">
        <span className="credit-fill" style={{ width: `${(fill * 100).toFixed(1)}%` }} />
      </span>
      <span className="credit-balance">
        <b>{formatCents(me.creditCents)}</b> left <span>· {formatCents(used)} used</span>
      </span>
      <div className="credit-detail">
        <p className="credit-detail-text" id="credit-detail-text">
          {formatCents(me.creditCents)} left — about {remaining} more{" "}
          {remaining === 1 ? "article" : "articles"}.
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
            <> Process an article and it stays readable for everyone after you.</>
          )}
        </p>
        <button type="button" className="credit-detail-cta" onClick={onDonate}>
          Donate
        </button>
      </div>
    </div>
  );
}
