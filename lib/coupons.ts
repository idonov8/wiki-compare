/**
 * The codes, and what each one is worth.
 *
 * A plain table rather than a database row, because a coupon here is a piece of
 * copy — it goes out in a tweet or at the end of a talk — and the thing that
 * decides whether it is real should be reviewable in a diff. A `coupons` table
 * would mean the set of live codes is invisible to everyone who reads the code
 * and editable by anyone who reaches the database, which is the wrong shape for
 * something whose whole job is to hand out money. What *is* in the database is
 * the other half: who has redeemed what, which is a fact about people rather
 * than a decision about policy.
 *
 * No driver and no secrets in this file, so the browser can import it too — the
 * same reason lib/pricing.ts is pure arithmetic.
 */

/** Code → cents of credit. Keys are upper case; see `normalizeCoupon`. */
export const COUPONS: Record<string, number> = {
  WELCOME3: 300,
};

/**
 * The form a code takes for lookup and for storage.
 *
 * Case-folded and trimmed because a code is something a person read off a
 * screen and typed back in, often with a phone keyboard that capitalised the
 * first letter for them. Rejecting `Welcome3` would be rejecting the right code
 * for being typed the way people type. Storing the normalised form as well as
 * matching on it keeps the redemption ledger from holding four spellings of one
 * coupon.
 */
export function normalizeCoupon(input: string): string {
  return input.trim().toUpperCase();
}

/** What a code is worth, or null if it is not one of ours. */
export function couponValue(input: string): number | null {
  const cents = COUPONS[normalizeCoupon(input)];
  return typeof cents === "number" ? cents : null;
}
