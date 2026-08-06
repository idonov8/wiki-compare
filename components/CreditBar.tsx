"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { track } from "@/lib/analytics";
import { articlesFor, formatCents } from "@/lib/pricing";
import type { MeResponse } from "@/lib/types";

/**
 * What the reader has left, and what they have already given.
 *
 * The meter is proportional to the most this account has ever held rather than
 * to a fixed ceiling, so it empties as credit is spent and refills when more is
 * added. A bar against an arbitrary maximum would tell somebody who donated a
 * dollar that they are nearly empty on the day they arrived.
 *
 * The thank-you is the reason this exists at all. It names two numbers — what
 * they processed, and how many people have read it since — because a donation
 * here does not buy the donor anything they could not otherwise have. It buys
 * other people's reading, and the only honest way to thank somebody for that is
 * to say how much of it there has been.
 */
export default function CreditBar({ me, onDonate }: { me: MeResponse | null; onDonate: () => void }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!me) {
    if (sent) return <div className="signin">Check your email for a link.</div>;
    return (
      <form
        className="signin-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const address = email.trim();
          if (!address || busy) return;
          setBusy(true);
          setError(null);
          void track("login_requested", {});
          const { error: failed } = await authClient.signIn.magicLink({
            email: address,
            callbackURL: window.location.pathname + window.location.search,
          });
          setBusy(false);
          if (failed) setError(failed.message ?? "That didn't send. Try again?");
          else setSent(true);
        }}
      >
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Sign in with your email"
          aria-label="Email address"
          required
        />
        <button type="submit" disabled={busy}>
          {busy ? "…" : "Sign in"}
        </button>
        {error && <span className="signin-error">{error}</span>}
      </form>
    );
  }

  const remaining = articlesFor(me.creditCents);
  // Never divide by a zero peak: a brand-new account has held nothing, and an
  // empty meter is the honest picture of an empty balance.
  const fill = me.peakCreditCents > 0 ? Math.min(1, me.creditCents / me.peakCreditCents) : 0;

  return (
    <div className="credit" tabIndex={0} aria-describedby="credit-tip">
      <span className="credit-meter" aria-hidden="true">
        <span className="credit-fill" style={{ width: `${(fill * 100).toFixed(1)}%` }} />
      </span>
      <span className="credit-balance">{formatCents(me.creditCents)}</span>
      <span className="credit-tip" id="credit-tip" role="tooltip">
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
      </span>
      <button className="signin" onClick={onDonate}>
        Add
      </button>
    </div>
  );
}
