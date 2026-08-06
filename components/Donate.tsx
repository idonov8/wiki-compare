"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { initAnalytics, track } from "@/lib/analytics";
import { articlesFor, formatCents } from "@/lib/pricing";
import type { DonateResponse, MeResponse } from "@/lib/types";

const PRESETS = [100, 300, 500, 1000];

/** A sixth of the gift, rounded to a whole 50c, as an opening suggestion. */
function suggestedMaintenance(amountCents: number): number {
  return Math.round(amountCents / 6 / 50) * 50;
}

/**
 * The payment page, which cannot take a payment.
 *
 * Everything here is real except the transaction: the amounts, the article
 * estimates, the running-costs contribution and the monthly option are all the
 * shape this would take if it worked, because the point of the page is to find
 * out whether anybody wants it to. What gets recorded is the attempt.
 *
 * The reveal is deliberately warm rather than apologetic-in-the-error-sense.
 * Somebody who reached the end of this form has offered money to a site that
 * asked for it and then couldn't take it, and the least it can do is be pleased
 * about that rather than sorry.
 */
export default function Donate() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [amount, setAmount] = useState(500);
  const [custom, setCustom] = useState("");
  const [maintenance, setMaintenance] = useState(String(suggestedMaintenance(500) / 100));
  const [monthly, setMonthly] = useState(false);
  const [coupon, setCoupon] = useState("");
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DonateResponse | null>(null);

  const from =
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("from");

  useEffect(() => {
    initAnalytics();
    void track("donate_page_viewed", { from });
    fetch("/api/me")
      .then((r) => r.json())
      .then((json) => setMe(json))
      .catch(() => {})
      .finally(() => setLoaded(true));
    // `from` is read once off the URL this page was opened with; it cannot change
    // without a navigation, and re-running this on it would re-fire the event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const amountCents = custom.trim() ? Math.round(parseFloat(custom) * 100) || 0 : amount;
  const maintenanceCents = Math.round(parseFloat(maintenance) * 100) || 0;

  if (result) {
    return (
      <div className="donate">
        <p className="donate-reveal">{result.message}</p>
        {result.granted && (
          <p>
            That&apos;s {articlesFor(result.grantedCents)} articles. Every one you process stays
            readable for everyone who comes after you.
          </p>
        )}
        <p>
          <a href="/">Back to the articles</a>
        </p>
      </div>
    );
  }

  return (
    <div className="donate">
      <h1>Cover the cost of reading</h1>
      <p>
        This isn&apos;t a subscription and nobody is making money here. Comparing one article in
        three languages costs real tokens; a donation covers a share of that. Whatever you process
        is then free for everyone else who opens it — including people who never gave anything.
      </p>

      <div className="donate-amounts">
        {PRESETS.map((cents) => (
          <button
            key={cents}
            className="amount"
            aria-pressed={!custom.trim() && amount === cents}
            onClick={() => {
              setAmount(cents);
              setCustom("");
              setMaintenance(String(suggestedMaintenance(cents) / 100));
            }}
          >
            {formatCents(cents)}
            <span className="amount-articles">≈ {articlesFor(cents)} articles</span>
          </button>
        ))}
      </div>

      <div className="donate-field">
        <label htmlFor="custom">Or another amount</label>
        <small>≈ {articlesFor(amountCents)} articles</small>
        <input
          id="custom"
          inputMode="decimal"
          value={custom}
          placeholder="0.00"
          onChange={(e) => setCustom(e.target.value)}
        />
      </div>

      <div className="donate-field">
        <label htmlFor="maintenance">Towards running the site</label>
        <small>Hosting and upkeep. Doesn&apos;t buy credit.</small>
        <input
          id="maintenance"
          inputMode="decimal"
          value={maintenance}
          onChange={(e) => setMaintenance(e.target.value)}
        />
      </div>

      <label className="donate-monthly">
        <input type="checkbox" checked={monthly} onChange={(e) => setMonthly(e.target.checked)} />
        Repeat this every month
        <small>Cancel whenever. We&apos;ll email before each one.</small>
      </label>

      <div className="donate-field">
        <label htmlFor="coupon">Coupon code</label>
        <input id="coupon" value={coupon} onChange={(e) => setCoupon(e.target.value)} />
      </div>

      {loaded && !me && (
        <div className="donate-field">
          <label htmlFor="email">Your email</label>
          <small>
            {sent ? "Check your email for a link, then come back." : "So the credit has somewhere to go."}
          </small>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>
      )}

      <button
        className="donate-pay"
        disabled={busy || amountCents <= 0}
        onClick={async () => {
          setBusy(true);
          setError(null);

          // Signed out, the pay button sends a magic link instead of a payment.
          // Asking somebody to go and find a sign-in control before they can
          // give money is how you lose the donation, so the button they already
          // pressed does the next necessary thing.
          if (!me) {
            const address = email.trim();
            if (!address) {
              setError("Add your email so the credit has somewhere to go.");
              setBusy(false);
              return;
            }
            void track("login_requested", { from: "donate" });
            const { error: failed } = await authClient.signIn.magicLink({
              email: address,
              callbackURL: "/donate?from=email",
            });
            setBusy(false);
            if (failed) setError(failed.message ?? "That didn't send. Try again?");
            else setSent(true);
            return;
          }

          try {
            const res = await fetch("/api/donate", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                amountCents,
                maintenanceCents,
                monthly,
                coupon: coupon.trim() || undefined,
                from,
              }),
            });
            const json = await res.json();
            if (!res.ok) throw new Error(json.error ?? "That didn't go through.");
            setResult(json as DonateResponse);
          } catch (e) {
            setError(e instanceof Error ? e.message : "That didn't go through.");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? "One moment…"
          : me
            ? `Pay ${formatCents(amountCents + maintenanceCents)}${monthly ? " a month" : ""}`
            : sent
              ? "Link sent"
              : "Continue"}
      </button>

      {error && <p className="gate-note gate-error">{error}</p>}
    </div>
  );
}
