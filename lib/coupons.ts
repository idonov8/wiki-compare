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
};

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
