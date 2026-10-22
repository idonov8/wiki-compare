import { spentSince } from "./db";

/**
 * A ceiling on what the site spends on models in a day, across every visitor.
 * The per-visitor limits in lib/rate-limit.ts live in one server instance's
 * memory, so they slow a loop down but cannot bound a bill; this can, because
 * it reads what was actually stored.
 */
const DAILY_USD = Number(process.env.DAILY_BUDGET_USD) || 10;
/** How long one reading of the total is trusted, so a busy minute does not
 *  query the database on every request. */
const FRESH_MS = 60_000;

let reading: { at: number; day: string; usd: number } | null = null;

export class OverBudget extends Error {
  constructor() {
    super("Wiki Compare has used up today's budget for new comparisons. Already compared articles still open; please try again tomorrow.");
    this.name = "OverBudget";
  }
}

/** Throws OverBudget once today's (UTC) spend has reached the ceiling. Without a
 *  database there is nothing to read, and nothing is limited. */
export async function checkBudget(): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (!reading || reading.day !== day || now.getTime() - reading.at > FRESH_MS) {
    reading = { at: now.getTime(), day, usd: await spentSince(new Date(`${day}T00:00:00Z`)) };
  }
  if (reading.usd >= DAILY_USD) throw new OverBudget();
}
