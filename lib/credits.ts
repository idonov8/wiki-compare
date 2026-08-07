import { neon } from "@neondatabase/serverless";

/**
 * Money, over the HTTP client the rest of the app already uses.
 *
 * Balance changes deliberately do not go through Better Auth's update-user API.
 * That API is read-modify-write — it loads the row, applies the patch, writes it
 * back — so two tabs finishing a comparison at the same moment both read a 20c
 * balance, both subtract 20c, and both write 0c, and the second article was free.
 * A single UPDATE with the check in its own WHERE clause cannot be interleaved
 * that way: Postgres serialises the two statements on the row, and the loser
 * matches nothing and gets told so.
 *
 * Every identifier here is double-quoted, and that is load-bearing rather than
 * stylistic. `user` is a reserved word in Postgres, so the table has to be
 * quoted to be addressable at all, and Better Auth names its columns in
 * camelCase, so an unquoted `creditCents` is folded to `creditcents` and the
 * statement fails on a column that visibly exists.
 */

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Add it in the Vercel project settings.");
  return neon(url);
}

/**
 * Spends `cents`, or refuses. Returns the new balance, or null if the account
 * could not cover it.
 *
 * The affordability test lives in the WHERE clause rather than in a SELECT
 * before it, so there is no window between deciding the balance is sufficient
 * and drawing it down. Zero rows back means the row failed the test — the
 * account did not have the money — which is the only way this fails and the
 * reason it does not need to distinguish "no such user" from "too poor": in both
 * cases nothing was charged and nothing should be served.
 */
export async function debit(userId: string, cents: number): Promise<number | null> {
  const rows = await sql()`
    UPDATE "user" SET "creditCents" = "creditCents" - ${cents}
    WHERE id = ${userId} AND "creditCents" >= ${cents}
    RETURNING "creditCents"
  `;
  return rows.length ? (rows[0].creditCents as number) : null;
}

/**
 * Adds credit, and raises the high-water mark to match if this is a new peak.
 *
 * `peakCreditCents` moves in the same statement as the balance because it is the
 * denominator of the meter in the UI. Bumped separately it would be one failed
 * request away from being smaller than the balance it is supposed to bound, and
 * a meter that reads 500 of 300 is worse than no meter. GREATEST rather than an
 * assignment so a second grant on a partly-spent account raises the peak to the
 * new total, never lowers it back to it.
 */
export async function grant(userId: string, cents: number): Promise<number> {
  const rows = await sql()`
    UPDATE "user"
    SET "creditCents" = "creditCents" + ${cents},
        "peakCreditCents" = GREATEST("peakCreditCents", "creditCents" + ${cents})
    WHERE id = ${userId}
    RETURNING "creditCents"
  `;
  if (!rows.length) throw new Error(`No such user: ${userId}`);
  return rows[0].creditCents as number;
}

/**
 * Whether this account has already been given the one mock grant.
 *
 * Asked of the ledger rather than of a flag on the user, because the ledger is
 * where the fact already is and a second copy of it is a second thing that can
 * disagree. `SELECT 1 ... LIMIT 1` — nothing about the row matters except that
 * one exists.
 */
export async function hasHadMockGrant(userId: string): Promise<boolean> {
  const rows = await sql()`
    SELECT 1 FROM donations WHERE user_id = ${userId} AND mock LIMIT 1
  `;
  return rows.length > 0;
}

export interface DonationRecord {
  userId: string;
  amountCents: number;
  maintenanceCents: number;
  monthly: boolean;
  coupon?: string;
  /** Zero on every attempt after the first — the intent is still worth recording. */
  grantedCents: number;
}

/**
 * Writes the attempt down, funded or not.
 *
 * Called before knowing whether credit was granted, and called even when it was
 * not. An unfunded attempt is the most informative row in this table: people
 * reaching the payment page and going through with it is the evidence for
 * whether any of this is worth building for real, and a table that only records
 * the successes cannot answer that question at all.
 */
export async function recordDonation(donation: DonationRecord): Promise<void> {
  await sql()`
    INSERT INTO donations (user_id, amount_cents, maintenance_cents, monthly, coupon, granted_cents)
    VALUES (
      ${donation.userId}, ${donation.amountCents}, ${donation.maintenanceCents},
      ${donation.monthly}, ${donation.coupon ?? null}, ${donation.grantedCents}
    )
  `;
}

export interface SpendRecord {
  userId: string;
  qid: string;
  cacheKey: string;
  /** What was bought — a preview, a full run — as the caller names it. */
  kind: string;
  chargedCents: number;
  /** What the tokens actually cost, when it is known. The gap between this and
   *  `chargedCents` is the number that says whether the price is right. */
  actualCostCents?: number;
}

export async function recordSpend(spend: SpendRecord): Promise<void> {
  await sql()`
    INSERT INTO spends (user_id, qid, cache_key, kind, charged_cents, actual_cost_cents)
    VALUES (
      ${spend.userId}, ${spend.qid}, ${spend.cacheKey}, ${spend.kind},
      ${spend.chargedCents}, ${spend.actualCostCents ?? null}
    )
  `;
}

/**
 * The two figures the credit bar thanks somebody with.
 *
 * One is what they paid to have read; the other is how many times those readings
 * have since been served to somebody else, which is the part that makes a
 * donation mean more than its own article. Both COALESCE to 0: SUM over no rows
 * is null, not zero, and an account that has not spent anything yet should read
 * "0 articles", not "null articles".
 */
export async function creditSummary(
  userId: string,
): Promise<{ articlesProcessed: number; readsOfThoseArticles: number }> {
  const rows = await sql()`
    SELECT
      (SELECT COUNT(*) FROM spends WHERE user_id = ${userId}) AS processed,
      (SELECT COALESCE(SUM(served_count), 0) FROM comparisons WHERE funded_by = ${userId}) AS reads
  `;
  return {
    articlesProcessed: Number(rows[0].processed),
    readsOfThoseArticles: Number(rows[0].reads),
  };
}
