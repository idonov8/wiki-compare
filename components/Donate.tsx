"use client";

import { useEffect, useState } from "react";
import SignIn from "@/components/SignIn";
import { initAnalytics, track } from "@/lib/analytics";
import { articlesFor, formatCents } from "@/lib/pricing";
import type { CouponCheck, DonateResponse, MeResponse } from "@/lib/types";

const PRESETS = [100, 300, 500, 1000];

/** About a sixth of the gift, rounded to a quarter, as an opening suggestion. */
/**
 * The exact proposition the opt-in box puts, kept as a constant because
 * app/api/donate/route.ts stores this same sentence as the evidence of what was
 * agreed to. If the two drift, the consent log starts attesting to words nobody
 * was shown, which is worse than having no log.
 */
const EMAIL_OPT_IN_WORDING = "I'd like to recieve updates about the project";

function suggestedMaintenance(amountCents: number): number {
  return Math.round((amountCents * 0.15) / 25) * 25;
}

/**
 * The JSON body, or an error that says what actually happened.
 *
 * A route that throws answers 500 with zero bytes, and `res.json()` on zero
 * bytes raises "Unexpected end of JSON input" — a parser describing the shape
 * of nothing, shown to somebody who typed a coupon code. Read as text first, so
 * an empty or unparseable body reports the status instead.
 */
async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`The server sent back nothing at all (${res.status}). Check the server log.`);
  }
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`The server sent back something unreadable (${res.status}).`);
  }
}

/** The `error` a route reported, if it reported one. */
function errorFrom(json: Record<string, unknown>, fallback: string): string {
  return typeof json.error === "string" && json.error ? json.error : fallback;
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
  const [emailOptIn, setEmailOptIn] = useState(true);
  const [coupon, setCoupon] = useState("");
  // No state for "redeemed": the moment that happens, this page is leaving.
  const [checking, setChecking] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [applied, setApplied] = useState<CouponCheck | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DonateResponse | null>(null);
  // The reveal holds for a beat on a dark screen before the sentence lands, so
  // the form the user just filled in is gone from view first — the page turns
  // dark, a loader turns, and only then does the thank-you arrive.
  const [revealing, setRevealing] = useState(false);

  useEffect(() => {
    if (!revealing) return;
    const t = setTimeout(() => setRevealing(false), 2600);
    return () => clearTimeout(t);
  }, [revealing]);

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
  const subtotalCents = amountCents + maintenanceCents;
  const discountCents = applied?.cents ?? 0;
  // Floored rather than capped: a coupon bigger than the order gives no change,
  // the way a paper one doesn't.
  const totalCents = Math.max(0, subtotalCents - discountCents);
  const articles = articlesFor(amountCents);

  /**
   * Checks the typed code. Takes nothing, grants nothing — redeeming is the pay
   * button's job, so this stops short of it and sets up the order it will cover.
   */
  async function applyCoupon(): Promise<void> {
    const code = coupon.trim();
    if (!code || checking || applied) return;
    setChecking(true);
    setCouponError(null);
    void track("coupon_submitted", { from });
    try {
      const res = await fetch(`/api/coupon?code=${encodeURIComponent(code)}`);
      const json = await readJson(res);
      if (!res.ok) throw new Error(errorFrom(json, "That code didn't check out."));
      const good = json as unknown as CouponCheck;
      setApplied(good);
      setCoupon(good.code);
      // The coupon becomes the order and then pays for it: processing set to
      // exactly what the code is worth, upkeep to nothing, so the total is zero
      // and the articles it buys are the coupon's.
      setAmount(good.cents);
      setCustom("");
      setMaintenance("0");
    } catch (e) {
      setCouponError(e instanceof Error ? e.message : "That code didn't check out.");
    } finally {
      setChecking(false);
    }
  }

  /* ---- the reveal ---- */

  if (result) {
    return (
      // The reveal arrives on a page of its own rather than under the form it
      // replaced, so the page turns dark and the form the user just left is
      // gone from view before the thank-you lands. White on ink, centred,
      // nothing else on the screen. `.donate`'s own sizing (max-width, margin,
      // padding) is entirely overridden below — this screen is fixed and full-bleed.
      <div className="donate donate-done fixed inset-0 max-w-none m-0 px-[24px] py-[32px] flex flex-col items-center justify-center text-center bg-ink text-paper-raised z-[1000]">
        {revealing ? (
          // A quiet ring, the only thing moving while the thank-you is being prepared.
          <div
            className="donate-reveal-loader w-[34px] h-[34px] border-[3px] border-paper-22 border-t-paper-raised rounded-full animate-reveal-spin"
            aria-label="Preparing your thank-you"
          />
        ) : (
          // Fades in once the loader has had its beat, so the sentence arrives
          // rather than snapping. Wide enough for the gift figure to breathe.
          // Laid out as a hierarchy rather than one flat sentence: a mono kicker
          // sets the register, the display headline carries the emotion, the
          // granted amount lands as a hero figure, and the body closes with the
          // thanks or the promise.
          <div className="donate-reveal-content max-w-[40ch] animate-reveal-in">
            {/* The full sentence, for screen readers; the sighted layout below
                carries the same meaning split into a hierarchy. */}
            <p className="sr-only">{result.message}</p>

            {result.reveal.kicker && (
              <p className="donate-reveal-kicker mb-[18px] font-mono text-[11px] font-normal tracking-[0.16em] uppercase text-paper-62">
                {result.reveal.kicker}
              </p>
            )}
            <h2 className="donate-reveal-headline mb-[28px] font-display font-normal text-[clamp(28px,6vw,38px)] leading-[1.12] text-paper-raised">
              {result.reveal.headline}
            </h2>

            {/* The gift: the granted amount as the largest thing on the screen,
                with a quiet mono label beneath it. Only present when credit was
                actually granted. */}
            {result.reveal.gift && (
              <div
                className="donate-reveal-gift flex flex-col items-center gap-[6px] mb-[30px]"
                aria-label={`${result.reveal.gift} of credit`}
              >
                <span className="donate-reveal-gift-amount font-display font-normal text-[clamp(56px,16vw,84px)] leading-[0.95] text-paper-raised">
                  {result.reveal.gift}
                </span>
                <span className="donate-reveal-gift-label font-mono text-[11px] tracking-[0.14em] uppercase text-paper-55">
                  of credit, on us
                </span>
              </div>
            )}

            <p className="donate-reveal-body mb-[18px] font-body text-[17px] leading-[1.6] text-paper-86">
              {result.reveal.body}
            </p>

            {result.granted && (
              <p className="donate-reveal-note mb-[32px] font-body text-[13.5px] leading-[1.6] text-paper-60">
                That&apos;s {articlesFor(result.grantedCents)} articles. Every one you process stays
                readable for everyone who comes after you.
              </p>
            )}

            <p className="donate-reveal-back m-0">
              <a
                href="/"
                className="font-mono text-[12px] tracking-[0.1em] uppercase text-paper-raised underline underline-offset-4"
              >
                Back to the main site
              </a>
            </p>
          </div>
        )}
      </div>
    );
  }

  /* ---- step one: who is giving ---- */

  // Nothing at all until `/api/me` answers. A donation form that appears for a
  // beat and is then replaced by a sign-in screen reads as the site changing its
  // mind about whether it wants the money. Placed where the sign-in screen's
  // heading will be, so the arrival of either step does not move the page.
  if (!loaded)
    return (
      <p className="donate-waiting max-w-[380px] mx-auto pt-[76px] px-[24px] pb-[96px] max-tight:pt-[48px] max-tight:px-[18px] max-tight:pb-[72px] font-mono text-[12px] text-ink-soft">
        One moment…
      </p>
    );

  // `SignIn` owns its own page container, so it is rendered bare — wrapping it
  // would put this page's margins inside somebody else's.
  if (!me) {
    return (
      <SignIn
        callbackURL={`/donate${from ? `?from=${encodeURIComponent(from)}` : ""}`}
        heading="Nice to meet you"
        blurb="Please sign in. Your donation will be linked to your account, and you can choose how it's used."
      />
    );
  }

  /* ---- step two: the order ---- */

  return (
    // The single reading column this page used to be was right when it was one
    // decision. It is now two — sign in, then order — and the order step has to
    // answer the question every payment screen answers before the button is
    // pressed: what am I about to be charged. Nothing here is styled to look
    // like somebody else's Stripe page: it is the shape of a checkout — choices,
    // itemisation, total, one button — at the type sizes this site already
    // uses, wider than the single reading column because there are now two of
    // them side by side.
    <div className="donate donate-checkout max-w-[1080px] mx-auto pt-[56px] px-[24px] pb-[88px] max-tight:pt-[38px] max-tight:px-[18px] max-tight:pb-[64px]">
      {/* The heading spans the full measure so the page opens with a clear
          title; the lede beneath it is capped at a readable measure rather
          than the column width, so the lines stay comfortable however wide
          the checkout gets. */}
      <header className="donate-head max-w-none mb-[40px] max-tight:mb-[26px]">
        <h1 className="font-display text-[46px] font-normal leading-[1.08] tracking-[-0.01em] mb-[16px] max-tight:text-[32px]">
          Help us pay the bills
        </h1>
        <p className="max-w-[70ch] m-0 text-[15px] leading-[1.6] text-ink-soft">
          I&apos;m glad to see you here! This site is my passion project.
          <br />
          Your donation lets you process articles for everyone to read and learn from.
        </p>
      </header>

      {/* Choices left, summary right; the summary follows the form when there
          is only one column, because on a phone the thing you scroll towards
          is the total. */}
      <div className="donate-layout grid grid-cols-[minmax(0,1fr)_340px] gap-[56px] items-start max-cols:grid-cols-1 max-cols:gap-[30px]">
        <div className="donate-choices">
          <section className="donate-block [&+&]:mt-[34px]">
            {/* Section headings at caption size: they group the fields, they
                are not competing with the page title or with the total. */}
            <h2 className="donate-block-title mb-[14px] font-mono text-[11px] font-normal tracking-[0.09em] uppercase text-ink-soft">
              Processing to fund
            </h2>

            {/* Two by two rather than a flexed row: in a column this width the
                fourth tile wraps on its own and stretches to the full measure,
                which reads as a bigger offer than the three above it rather
                than as the last of four equals. */}
            <div className="donate-amounts grid grid-cols-2 gap-[8px]">
              {PRESETS.map((cents) => (
                <button
                  key={cents}
                  // The same two states as the language toggle, at the size of
                  // a decision rather than of a filter: outline while unchosen,
                  // solid ink once chosen.
                  className="amount flex-[1_1_132px] py-[13px] px-[14px] bg-transparent border border-rule font-mono text-[16px] leading-[1.3] text-ink-soft text-center aria-pressed:bg-ink aria-pressed:border-ink aria-pressed:text-paper-raised"
                  aria-pressed={!custom.trim() && amount === cents}
                  onClick={() => {
                    setAmount(cents);
                    setCustom("");
                    setMaintenance(String(suggestedMaintenance(cents) / 100));
                  }}
                >
                  {formatCents(cents)}
                  {/* What the money buys, under the price. `inherit` and
                      opacity rather than a fixed grey, so the line stays
                      legible when the tile fills with ink. */}
                  <span className="amount-articles block mt-[4px] font-mono text-[11px] tracking-[0.04em] text-inherit opacity-[0.72]">
                    ≈ {articlesFor(cents)} articles
                  </span>
                </button>
              ))}
            </div>

            {/* Label on the left, a short value on the right: the custom
                amount, the contribution to running the thing, and the coupon
                all read as one column of figures against the same margin. */}
            <div className="donate-field flex items-baseline gap-[14px] py-[14px] border-t border-rule max-tight:flex-wrap max-tight:gap-[6px_14px]">
              {/* The hint now lives inside the label, so the whole line is a
                  click target for the field beside it. */}
              <label htmlFor="custom" className="flex-[1_1_auto] min-w-0 text-[14px] cursor-pointer">
                Or another amount
                <small className="block text-[12.5px] leading-[1.5] text-ink-soft">
                  ≈ {articles} articles
                </small>
              </label>
              <input
                id="custom"
                inputMode="decimal"
                value={custom}
                placeholder="0.00"
                onChange={(e) => setCustom(e.target.value)}
                className="flex-[0_0_118px] w-[118px] font-mono text-[14px] py-[8px] px-[10px] bg-paper-raised border border-rule rounded-[2px] text-inherit text-end placeholder:text-ink-soft max-tight:flex-[1_1_100%] max-tight:w-auto max-tight:text-start"
              />
            </div>
          </section>

          <section className="donate-block [&+&]:mt-[34px]">
            <h2 className="donate-block-title mb-[14px] font-mono text-[11px] font-normal tracking-[0.09em] uppercase text-ink-soft">
              And the rest of it
            </h2>

            <div className="donate-field flex items-baseline gap-[14px] py-[14px] border-t border-rule max-tight:flex-wrap max-tight:gap-[6px_14px]">
              <label htmlFor="maintenance" className="flex-[1_1_auto] min-w-0 text-[14px] cursor-pointer">
                Towards running the site
                <small className="block text-[12.5px] leading-[1.5] text-ink-soft">
                  Hosting and upkeep. Doesn&apos;t buy credit.
                </small>
              </label>
              <input
                id="maintenance"
                inputMode="decimal"
                value={maintenance}
                onChange={(e) => setMaintenance(e.target.value)}
                className="flex-[0_0_118px] w-[118px] font-mono text-[14px] py-[8px] px-[10px] bg-paper-raised border border-rule rounded-[2px] text-inherit text-end placeholder:text-ink-soft max-tight:flex-[1_1_100%] max-tight:w-auto max-tight:text-start"
              />
            </div>

            {/* One continuous ruled list per block: the monthly row loses its
                own bottom rule and its trailing margin so the coupon row's
                top rule is the only line there. */}
            <label className="donate-monthly flex items-baseline gap-[10px] py-[14px] border-t border-rule text-[14px]">
              <input
                type="checkbox"
                checked={monthly}
                onChange={(e) => setMonthly(e.target.checked)}
                className="flex-none w-[15px] h-[15px] accent-ink relative top-[2px]"
              />
              <span>
                Repeat this every month
                <small className="block text-[12.5px] text-ink-soft">
                  Cancel whenever, from your account.
                </small>
              </span>
            </label>

            {/* Unticked, and stays unticked. The row is separate from the
                monthly one above rather than folded into it because s.30A wants
                consent to being advertised to, given on its own — a box that
                also means "charge me every month" is not that, and a donation is
                not consent to anything. The wording is duplicated verbatim in
                app/api/donate/route.ts, which stores it alongside the answer. */}
            <label className="donate-email-optin flex items-baseline gap-[10px] py-[14px] border-t border-rule text-[14px]">
              <input
                type="checkbox"
                checked={emailOptIn}
                onChange={(e) => setEmailOptIn(e.target.checked)}
                className="flex-none w-[15px] h-[15px] accent-ink relative top-[2px]"
              />
              <span>
                {EMAIL_OPT_IN_WORDING}
                <small className="block text-[12.5px] text-ink-soft">
                  Major milestone updates only. No spam, promise.
                </small>
              </span>
            </label>

            {/* The small button answers "is this code real" on the spot, so
                nobody has to commit to a donation to find out. It stops there:
                the credit still arrives on the pay button. */}
            <div className="donate-field donate-coupon flex items-baseline gap-[14px] py-[14px] border-t border-rule max-tight:flex-wrap max-tight:gap-[6px_14px]">
              <label htmlFor="coupon" className="flex-[1_1_auto] min-w-0 text-[14px] cursor-pointer">
                Coupon code
                {/* One line, three things it can say. `role="status"` so a
                    press is announced; the words change, not just the colour. */}
                <small
                  role="status"
                  className={`block text-[12.5px] leading-[1.5] ${
                    couponError ? "text-contradiction" : "text-ink-soft"
                  }`}
                >
                  {applied
                    ? `${formatCents(applied.cents)} off — ${articlesFor(applied.cents)} articles, on us.`
                    : (couponError ?? "If somebody gave you one. Check it before you decide.")}
                </small>
              </label>
              {/* Field and button wrap together, so on a phone the button
                  never lands under the code it belongs to. */}
              <div className="donate-coupon-entry flex-none flex items-center gap-[8px] max-tight:flex-[1_1_100%]">
                <input
                  id="coupon"
                  value={coupon}
                  placeholder="Optional"
                  disabled={!!applied}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(e) => {
                    setCoupon(e.target.value);
                    // The refusal was about the code that has just been
                    // replaced, so it stops being true as it is typed over.
                    if (couponError) setCouponError(null);
                  }}
                  // Not inside a form, so Enter is wired up by hand.
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void applyCoupon();
                    }
                  }}
                  className="flex-[0_0_118px] w-[118px] font-mono text-[14px] py-[8px] px-[10px] bg-paper-raised border border-rule rounded-[2px] text-inherit text-end uppercase placeholder:normal-case placeholder:text-ink-soft disabled:opacity-[0.6] max-tight:flex-1 max-tight:w-auto max-tight:text-start"
                />
                {/* Outlined, not filled: the pay button keeps the page's only
                    block of ink, since this one finishes nothing. */}
                <button
                  type="button"
                  className="donate-redeem flex-none py-[8px] px-[13px] font-mono text-[12px] tracking-[0.04em] bg-transparent text-ink border border-ink rounded-[2px] transition-[background,color] duration-[120ms] ease-[ease] hover:not-disabled:bg-ink hover:not-disabled:text-paper-raised disabled:opacity-[0.4] disabled:cursor-default"
                  disabled={checking || !!applied || !coupon.trim()}
                  onClick={() => void applyCoupon()}
                >
                  {applied ? "Checked" : checking ? "One moment…" : "Check"}
                </button>
              </div>
            </div>
          </section>
        </div>

        <aside
          className="donate-summary sticky top-[24px] max-cols:static p-[20px] pb-[22px] bg-paper-raised border border-ink rounded-[2px] shadow-offset-soft"
          aria-labelledby="summary-title"
        >
          <div className="summary-head flex items-baseline justify-between gap-[12px] pb-[14px]">
            <h2
              id="summary-title"
              className="m-0 font-mono text-[11px] font-normal tracking-[0.09em] uppercase text-ink-soft"
            >
              Order summary
            </h2>
            {/* Who the credit would land on. A caption, not a field. */}
            <p className="summary-who m-0 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-ink-soft">
              {me.email}
            </p>
          </div>

          <dl className="summary-lines m-0">
            <div className="summary-line flex items-baseline justify-between gap-[16px] py-[12px] border-t border-rule">
              <dt className="flex-[1_1_auto] min-w-0 text-[14px] leading-[1.4]">
                Processing donation
                <small className="block mt-[3px] font-body text-[12px] leading-[1.45] text-ink-soft">
                  about {articles} articles, free for everyone after
                </small>
              </dt>
              <dd className="flex-none m-0 font-mono text-[15px] whitespace-nowrap">
                {formatCents(amountCents)}
              </dd>
            </div>

            <div className="summary-line flex items-baseline justify-between gap-[16px] py-[12px] border-t border-rule">
              <dt className="flex-[1_1_auto] min-w-0 text-[14px] leading-[1.4]">
                Towards running the site
                <small className="block mt-[3px] font-body text-[12px] leading-[1.45] text-ink-soft">
                  hosting and upkeep — buys no credit
                </small>
              </dt>
              <dd className="flex-none m-0 font-mono text-[15px] whitespace-nowrap">
                {formatCents(maintenanceCents)}
              </dd>
            </div>

            {applied && (
              <div className="summary-line summary-line-quiet flex items-baseline justify-between gap-[16px] py-[12px] border-t border-rule">
                <dt className="flex-[1_1_auto] min-w-0 text-[14px] leading-[1.4]">
                  Coupon {applied.code}
                  <small className="block mt-[3px] font-body text-[12px] leading-[1.45] text-ink-soft">
                    covers the first {formatCents(applied.cents)}, applied when you press Pay
                  </small>
                </dt>
                <dd className="flex-none m-0 font-mono text-[15px] whitespace-nowrap">
                  −{formatCents(applied.cents)}
                </dd>
              </div>
            )}

            {/* The line the whole screen exists to show. Ruled in ink rather
                than in the ordinary rule tone, and the only figure on the
                page set above body size. */}
            <div className="summary-line summary-total flex items-baseline justify-between gap-[16px] pt-[14px] pb-[12px] mt-[2px] border-t border-ink">
              <dt className="flex-[1_1_auto] min-w-0 text-[15px] leading-[1.4]">
                Total
                {monthly && (
                  <small className="block mt-[3px] font-mono text-[11px] leading-[1.45] tracking-[0.03em] text-ink-soft">
                    billed every month
                  </small>
                )}
              </dt>
              <dd
                aria-live="polite"
                className="flex-none m-0 font-mono text-[22px] leading-[1.2] tracking-[-0.01em] whitespace-nowrap max-tight:text-[20px]"
              >
                {formatCents(totalCents)}
                {monthly && <span className="summary-per ms-[3px] text-[12px] text-ink-soft">/mo</span>}
              </dd>
            </div>
          </dl>

          <button
            className="donate-pay mt-[18px] block w-full py-[14px] px-[22px] bg-ink text-paper-raised border border-ink text-[16px] disabled:opacity-[0.45] disabled:cursor-progress"
            // A checked coupon is worth pressing this for, with nothing to pay.
            disabled={busy || (subtotalCents <= 0 && !applied)}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                // The coupon first, because it is the part that is real: if it
                // fails, no reveal should be celebrating something else.
                if (applied) {
                  const res = await fetch("/api/coupon", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ code: applied.code }),
                  });
                  const json = await readJson(res);
                  if (!res.ok) throw new Error(errorFrom(json, "That code didn't go through."));
                }

                // The coupon covered the whole order, so there is no payment to
                // attempt — and an unpaid attempt in `donations` would dilute
                // the one number that table exists to answer.
                if (totalCents <= 0) {
                  window.location.href = "/";
                  return;
                }

                const res = await fetch("/api/donate", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  // No coupon here: this button redeems one directly, above.
                  body: JSON.stringify({ amountCents, maintenanceCents, monthly, from, emailOptIn }),
                });
                // Same read as above: a bodyless 500 here had the same bug.
                const json = await readJson(res);
                if (!res.ok) throw new Error(errorFrom(json, "That didn't go through."));
                setResult(json as unknown as DonateResponse);
                setRevealing(true);
              } catch (e) {
                setError(e instanceof Error ? e.message : "That didn't go through.");
              } finally {
                setBusy(false);
              }
            }}
          >
            {/* "Pay $0.00" is not a thing to ask anybody to press. */}
            {busy
              ? "One moment…"
              : applied && totalCents === 0
                ? `Get ${formatCents(applied.cents)} of credit`
                : `Pay ${formatCents(totalCents)}${monthly ? " a month" : ""}`}
          </button>

          <p className="summary-note mt-[10px] text-[12px] leading-[1.5] text-ink-soft">
            {articles > 0
              ? `${articles} articles of processing, readable by everyone who opens them afterwards.`
              : applied
                ? `${articlesFor(applied.cents)} articles, on us. Add an amount above to fund more.`
                : "Enter an amount to fund some processing."}
          </p>

          {error && (
            // Nothing went wrong with the world, only with this request, so it
            // is set in the same caption face as the note above it and marked
            // by colour alone.
            <p
              className="donate-error mt-[10px] font-mono text-[11.5px] leading-[1.55] text-contradiction"
              role="status"
            >
              {error}
            </p>
          )}
        </aside>
      </div>
    </div>
  );
}
