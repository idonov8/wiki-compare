"use client";

import { useEffect, useRef, useState } from "react";
import { BANNER_COUPON, COUPONS, couponEndLabel, couponExpired } from "@/lib/coupons";
import { articlesFor, formatCents } from "@/lib/pricing";

const CENTS = COUPONS[BANNER_COUPON] ?? 0;
const STORAGE_KEY = `coupon-banner:${BANNER_COUPON}`;

/**
 * The offer, across the top of every page: a code, what it buys, and why a site
 * that costs money to run is handing credit out.
 *
 * Set as a tear-off rather than as a coloured notification bar. The code is the
 * only thing on the strip anybody has to carry away from it, so it is the one
 * piece with a border round it, in mono, on a dashed edge with a pair of
 * scissors at the head — and it is a button, because a code read off a screen
 * and typed back in is a code half the people who wanted it get wrong.
 *
 * Time-limited for real: the deadline printed here is `COUPON_ENDS`, which is
 * the same line `/api/coupon` refuses an expired code by, and the strip takes
 * itself down the moment that date passes rather than advertising something the
 * server would turn away.
 *
 * Rendered only after mount. Both of the things that decide whether it belongs
 * on screen — today's date and whether this browser has dismissed it — are
 * unknown to the server, and a strip that arrives in the HTML and then vanishes
 * is a page that moves under whoever is reading it.
 */
export default function CouponBanner() {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (couponExpired(BANNER_COUPON)) return;
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
    } catch {
      // A browser refusing storage is not a reason to withhold the offer.
    }
    setShow(true);
  }, []);

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    setShow(false);
    try {
      localStorage.setItem(STORAGE_KEY, "dismissed");
    } catch {
      // Then it comes back next visit, which is the harmless way to fail.
    }
  };

  return (
    <aside
      aria-label="Welcome credit"
      className="coupon-banner relative flex flex-wrap items-center gap-x-[22px] gap-y-[10px] border-b border-ink bg-ink px-[24px] py-[12px] text-paper-raised max-tight:gap-x-[10px] max-tight:gap-y-[4px] max-tight:px-[12px] max-tight:py-[7px] max-tight:pr-[28px]"
    >
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(BANNER_COUPON);
            setCopied(true);
            if (copiedTimer.current) clearTimeout(copiedTimer.current);
            copiedTimer.current = setTimeout(() => setCopied(false), 2000);
          } catch {
            // Nothing to say: the code is legible on the strip either way.
          }
        }}
        aria-label={`Copy the code ${BANNER_COUPON}`}
        className="flex items-baseline gap-[8px] border border-dashed border-paper-55 bg-transparent px-[11px] py-[6px] font-mono text-[13px] tracking-[0.18em] uppercase text-paper-raised hover:border-paper-raised hover:bg-paper-22 max-tight:order-2 max-tight:ms-auto max-tight:gap-[5px] max-tight:px-[7px] max-tight:py-[3px] max-tight:text-[11px]"
      >
        <span aria-hidden="true" className="text-[11px] tracking-normal opacity-70 max-tight:text-[9px]">
          ✂
        </span>
        {copied ? (
          <>
            <span className="max-tight:hidden">{BANNER_COUPON}</span>
            <span className="hidden max-tight:inline">copied</span>
          </>
        ) : (
          BANNER_COUPON
        )}
        <span
          className="font-mono text-[10px] tracking-[0.08em] normal-case opacity-70 max-tight:hidden"
          role="status"
        >
          {copied ? "copied" : "copy"}
        </span>
      </button>

      {/* The offer and the reason, one above the other: the figure is the news,
          the sentence under it is the argument, and neither reads as the other's
          small print when they are set at different sizes on their own lines. */}
      <div className="min-w-0 flex-[1_1_340px] max-tight:order-1 max-tight:flex-[1_1_100%]">
        <p className="m-0 font-mono text-[11px] tracking-[0.12em] uppercase text-paper-62 max-tight:text-[9px]">
          {formatCents(CENTS)} of credit · {articlesFor(CENTS)} articles · ends{" "}
          {couponEndLabel(BANNER_COUPON)}
        </p>
        <p className="m-0 font-body text-[13.5px] leading-[1.55] text-paper-86 max-tight:text-[12px] max-tight:leading-[1.4]">
          The project is not for profit, but AI costs money. Use credit to process articles for
          everyone.
        </p>
      </div>

      <a
        href="/donate?from=coupon-banner"
        className="border border-paper-raised bg-paper-raised px-[16px] py-[8px] font-mono text-[11px] uppercase tracking-[0.07em] text-ink no-underline hover:bg-paper-86 max-tight:order-3 max-tight:px-[10px] max-tight:py-[4px] max-tight:text-[10px]"
      >
        Redeem it
      </a>

      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss this offer"
        className="ms-auto bg-transparent px-[6px] font-mono text-[15px] leading-none text-paper-62 hover:text-paper-raised max-tight:absolute max-tight:top-1/2 max-tight:right-[8px] max-tight:-translate-y-1/2 max-tight:ms-0 max-tight:px-[2px] max-tight:text-[13px]"
      >
        ×
      </button>
    </aside>
  );
}
