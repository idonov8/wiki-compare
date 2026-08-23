/**
 * The codes, and what each one is worth.
 *
 * A table in the source rather than rows in the database: which codes hand out
 * money is a decision, and a decision should be reviewable in a diff rather
 * than editable by anyone who reaches the database. Who has redeemed what is
 * the fact half, and lives in coupon_redemptions.
 *
 * Pure, like lib/pricing.ts, so the browser can import it too.
 */

/** Code → cents of credit. Keys are upper case; see `normalizeCoupon`. */
export const COUPONS: Record<string, number> = {
  WELCOME3: 300,
  THANKU5: 500,
};

/**
 * The last day each code works, as a UTC calendar date.
 *
 * A code with no entry here never runs out. A date is the honest half of a
 * banner that says "ends the 26th": the strip on the front page and the check
 * behind the field read this same line, so the offer cannot outlive its own
 * advertisement in either direction.
 */
export const COUPON_ENDS: Record<string, string> = {
  WELCOME3: "2026-08-14",
};

/** The code the strip across the top of the site offers. */
export const BANNER_COUPON = "WELCOME3";

/** Midnight after the last working day, which is the instant a code dies. */
export function couponDeadline(input: string): Date | null {
  const day = COUPON_ENDS[normalizeCoupon(input)];
  return day ? new Date(new Date(`${day}T00:00:00Z`).getTime() + 86_400_000) : null;
}

/** The last day a code works, as "26 August", or null if it never runs out. */
export function couponEndLabel(input: string): string | null {
  const day = COUPON_ENDS[normalizeCoupon(input)];
  return day
    ? new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      })
    : null;
}

/** Whether a code has run out. Codes with no deadline never have. */
export function couponExpired(input: string, now: Date = new Date()): boolean {
  const deadline = couponDeadline(input);
  return deadline !== null && now >= deadline;
}

/**
 * The form a code takes for lookup and for storage. Case-folded because a code
 * is read off a screen and typed back in, often by a keyboard that capitalises
 * for you; normalised on the way into the ledger so it holds one spelling.
 */
export function normalizeCoupon(input: string): string {
  return input.trim().toUpperCase();
}

/** What a code is worth, or null if it is not one of ours. */
export function couponValue(input: string): number | null {
  const cents = COUPONS[normalizeCoupon(input)];
  return typeof cents === "number" ? cents : null;
}
