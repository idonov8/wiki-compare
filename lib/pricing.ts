import type { Usage } from "./types";

/**
 * What a comparison costs, in money rather than tokens.
 *
 * Pure arithmetic over a rate table, with no database driver and no SDK, because
 * both the server (which prices a run as it finishes) and the browser (which
 * prints the figure) need it — the same reason the shared shapes live in
 * lib/types.ts rather than in lib/db.ts.
 */

/** US dollars per million tokens. Cached input reads at a tenth of input. */
export const PRICE_PER_MTOK: Record<string, { input: number; output: number; cached: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5, cached: 0.1 },
  "claude-sonnet-4-6": { input: 3, output: 15, cached: 0.3 },
  "claude-sonnet-5": { input: 3, output: 15, cached: 0.3 },
  "claude-sonnet-5-5": { input: 2, output: 10, cached: 0.2 },
  "claude-opus-4-8": { input: 5, output: 25, cached: 0.5 },
  "claude-opus-5": { input: 5, output: 25, cached: 0.5 },
  // TypeSafe bills input only; output is free.
  jev: { input: 0.042, output: 0, cached: 0.042 },
};

/**
 * Rates for a model id, matched by prefix so the dated aliases the environment
 * may carry — `claude-haiku-4-5-20251001` — resolve to their family.
 *
 * An unknown model prices at the most expensive row rather than at zero. A model
 * we have no rate for is a model somebody just set in the environment, and
 * quietly reporting its runs as free is the one wrong answer: it would make the
 * cost readout lie in the direction nobody checks.
 */
export function ratesFor(model: string): { input: number; output: number; cached: number } {
  const key = Object.keys(PRICE_PER_MTOK)
    .filter((k) => model.startsWith(k))
    // Longest match wins, so `claude-sonnet-5` is not shadowed by a shorter row.
    .sort((a, b) => b.length - a.length)[0];
  if (key) return PRICE_PER_MTOK[key];
  return Object.values(PRICE_PER_MTOK).reduce((worst, r) => (r.output > worst.output ? r : worst));
}

const M = 1_000_000;

/**
 * What a run cost, in dollars.
 *
 * `byModel` is what makes this correct when a run spends tokens on models at
 * different rates: pricing the summed totals at any one rate is wrong in one
 * direction or the other. Rows stored before the breakdown existed have only the
 * totals — those price at `fallbackModel`, and `costApproximate` says so.
 */
export function costOfUsage(usage: Usage, fallbackModel: string): number {
  const breakdown = usage.byModel;
  if (!breakdown || !Object.keys(breakdown).length) {
    const rates = ratesFor(fallbackModel);
    return (
      ((usage.inputTokens - usage.cachedInputTokens) * rates.input +
        usage.cachedInputTokens * rates.cached +
        usage.outputTokens * rates.output) /
      M
    );
  }
  let total = 0;
  for (const [model, part] of Object.entries(breakdown)) {
    const rates = ratesFor(model);
    total +=
      ((part.inputTokens - part.cachedInputTokens) * rates.input +
        part.cachedInputTokens * rates.cached +
        part.outputTokens * rates.output) /
      M;
  }
  return total;
}

/** Whether a stored figure had to be guessed at from the totals. */
export function costApproximate(usage: Usage): boolean {
  return usage.costUsd === undefined && !usage.byModel;
}

/**
 * The model to price a run at when the run itself does not say: the one the
 * retired Claude engine spent nearly all of its tokens on. Every Jev run stores
 * its own `costUsd`, so only rows from before that was recorded ever reach it,
 * and it errs high on those.
 */
export const FALLBACK_PRICING_MODEL = "claude-sonnet-4-6";

/**
 * What a stored comparison cost, as a figure that knows how sure it is.
 *
 * Three cases, and the difference between them is the whole point:
 *  - a run priced at the time it ran, stored as `costUsd`: exact, and reported
 *    at the rates of the day it ran rather than today's.
 *  - a run from before that was recorded, carrying only token totals: real data,
 *    priced here at `FALLBACK_PRICING_MODEL` and flagged approximate. Refusing
 *    to say anything about these would leave most of the library silent about
 *    what it cost to build, which is the argument the site is making.
 *  - a run with no usable totals at all: null. Nothing true can be said, so
 *    nothing is said — an invented number would be worse than a gap.
 */
export function storedCost(usage: Usage): { usd: number; approximate: boolean } | null {
  if (typeof usage.costUsd === "number" && usage.costUsd > 0) {
    return { usd: usage.costUsd, approximate: false };
  }
  if (usage.inputTokens <= 0 && usage.outputTokens <= 0) return null;
  const usd = costOfUsage(usage, FALLBACK_PRICING_MODEL);
  return usd > 0 ? { usd, approximate: costApproximate(usage) } : null;
}

/**
 * The cost as it appears in the control strip.
 *
 * Anything under a cent reads as "<$0.01" rather than "$0.00": a run that spent
 * real money should never print as free, because free is exactly what a cache
 * hit prints and the two must not look alike.
 */
export function formatCost(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}
