"use client";

import { useEffect, useState } from "react";
import SignIn from "@/components/SignIn";
import { initAnalytics, track } from "@/lib/analytics";
import { articlesFor, formatCents } from "@/lib/pricing";
import type { DonateResponse, MeResponse } from "@/lib/types";

const PRESETS = [100, 300, 500, 1000];

/** About a sixth of the gift, rounded to a quarter, as an opening suggestion. */
function suggestedMaintenance(amountCents: number): number {
  return Math.round((amountCents * 0.15) / 25) * 25;
}

/** Cents from a typed decimal. Never negative: the form is not a place to owe us. */
function centsFrom(text: string): number {
  const n = Math.round(parseFloat(text) * 100);
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/**
 * The payment page, which cannot take a payment.
 *
 * Two steps, in the order a shop uses them: sign in, then check out. The gate is
 * not ceremony — the credit this grants lands on an account, so there has to be
 * an account before there is anything to grant, and asking for the address in
 * the middle of the order form was asking somebody to prove who they were while
 * they were still deciding how much to give.
 *
 * Everything on the second step is real except the transaction: the amounts, the
 * article estimates, the running-costs contribution, the monthly option and the
 * total that adds them up are all the shape this would take if it worked,
 * because the point of the page is to find out whether anybody wants it to. What
 * gets recorded is the attempt.
 *
 * The reveal is deliberately warm rather than apologetic-in-the-error-sense.
 * Somebody who reached the end of this form has offered money to a site that
 * asked for it and then couldn't take it, and the least it can do is be pleased
 * about that rather than sorry. Its wording comes from the server, which is the
 * only side that knows whether this account has been thanked before.
 */
export default function Donate() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [from, setFrom] = useState<string | null>(null);
  const [amount, setAmount] = useState(500);
  const [custom, setCustom] = useState("");
  const [maintenance, setMaintenance] = useState(String(suggestedMaintenance(500) / 100));
  const [monthly, setMonthly] = useState(false);
  const [coupon, setCoupon] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DonateResponse | null>(null);

  useEffect(() => {
    // Read off the URL here rather than during render: the server has no
    // `window`, and a value that appears only on the client is a hydration
    // mismatch waiting to happen.
    const opened = new URLSearchParams(window.location.search).get("from");
    setFrom(opened);
    initAnalytics();
    void track("donate_page_viewed", { from: opened });
    fetch("/api/me")
      .then((r) => r.json())
      .then((json: MeResponse | null) => setMe(json))
      .catch(() => {})
      .finally(() => setLoaded(true));
    // Runs once, on the URL this page was opened with. `from` cannot change
    // without a navigation, and re-running on it would re-fire the pageview.
  }, []);

  const amountCents = custom.trim() ? centsFrom(custom) : amount;
  const maintenanceCents = centsFrom(maintenance);
  const totalCents = amountCents + maintenanceCents;
  const articles = articlesFor(amountCents);

  /* ---- the reveal ---- */

  if (result) {
    return (
      <div className="donate donate-done">
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

  /* ---- step one: who is giving ---- */

  // Nothing at all until `/api/me` answers. A donation form that appears for a
  // beat and is then replaced by a sign-in screen reads as the site changing its
  // mind about whether it wants the money.
  if (!loaded) return <p className="donate-waiting">One moment…</p>;

  // `SignIn` owns its own page container, so it is rendered bare — wrapping it
  // would put this page's margins inside somebody else's.
  if (!me) {
    return (
      <SignIn
        callbackURL={`/donate${from ? `?from=${encodeURIComponent(from)}` : ""}`}
        heading="First, who is this from?"
        blurb="Credit lands on an account, so there has to be an account for it to land on. No password — we email you a link, and you come straight back here to finish."
      />
    );
  }

  /* ---- step two: the order ---- */

  return (
    <div className="donate donate-checkout">
      <header className="donate-head">
        <h1>Cover the cost of reading</h1>
        <p>
          This isn&apos;t a subscription and nobody is making money here. Comparing one article in
          three languages costs real tokens; a donation covers a share of that. Whatever you process
          is then free for everyone else who opens it — including people who never gave anything.
        </p>
      </header>

      <div className="donate-layout">
        <div className="donate-choices">
          <section className="donate-block">
            <h2 className="donate-block-title">Processing to fund</h2>

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
              <label htmlFor="custom">
                Or another amount
                <small>≈ {articles} articles</small>
              </label>
              <input
                id="custom"
                inputMode="decimal"
                value={custom}
                placeholder="0.00"
                onChange={(e) => setCustom(e.target.value)}
              />
            </div>
          </section>

          <section className="donate-block">
            <h2 className="donate-block-title">And the rest of it</h2>

            <div className="donate-field">
              <label htmlFor="maintenance">
                Towards running the site
                <small>Hosting and upkeep. Doesn&apos;t buy credit.</small>
              </label>
              <input
                id="maintenance"
                inputMode="decimal"
                value={maintenance}
                onChange={(e) => setMaintenance(e.target.value)}
              />
            </div>

            <label className="donate-monthly">
              <input
                type="checkbox"
                checked={monthly}
                onChange={(e) => setMonthly(e.target.checked)}
              />
              <span>
                Repeat this every month
                <small>Cancel whenever. We&apos;ll email before each one.</small>
              </span>
            </label>

            <div className="donate-field">
              <label htmlFor="coupon">
                Coupon code
                <small>If somebody gave you one.</small>
              </label>
              <input
                id="coupon"
                value={coupon}
                placeholder="Optional"
                onChange={(e) => setCoupon(e.target.value)}
              />
            </div>
          </section>
        </div>

        <aside className="donate-summary" aria-labelledby="summary-title">
          <div className="summary-head">
            <h2 id="summary-title">Order summary</h2>
            <p className="summary-who">{me.email}</p>
          </div>

          <dl className="summary-lines">
            <div className="summary-line">
              <dt>
                Processing donation
                <small>about {articles} articles, free for everyone after</small>
              </dt>
              <dd>{formatCents(amountCents)}</dd>
            </div>

            <div className="summary-line">
              <dt>
                Towards running the site
                <small>hosting and upkeep — buys no credit</small>
              </dt>
              <dd>{formatCents(maintenanceCents)}</dd>
            </div>

            {coupon.trim() && (
              <div className="summary-line summary-line-quiet">
                <dt>
                  Coupon
                  <small>checked when you pay</small>
                </dt>
                <dd>{coupon.trim().slice(0, 24)}</dd>
              </div>
            )}

            <div className="summary-line summary-total">
              <dt>
                Total
                {monthly && <small>billed every month</small>}
              </dt>
              <dd aria-live="polite">
                {formatCents(totalCents)}
                {monthly && <span className="summary-per">/mo</span>}
              </dd>
            </div>
          </dl>

          <button
            className="donate-pay"
            disabled={busy || amountCents <= 0}
            onClick={async () => {
              setBusy(true);
              setError(null);
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
            {busy ? "One moment…" : `Pay ${formatCents(totalCents)}${monthly ? " a month" : ""}`}
          </button>

          <p className="summary-note">
            {articles > 0
              ? `${articles} articles of processing, readable by everyone who opens them afterwards.`
              : "Enter an amount to fund some processing."}
          </p>

          {error && (
            <p className="donate-error" role="status">
              {error}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
