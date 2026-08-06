import type { Usage } from "./types";

/**
 * What a comparison costs, in money rather than tokens.
 *
 * Pure arithmetic over a rate table, with no database driver and no SDK, because
 * both the server (which prices a run as it finishes) and the browser (which
 * prints the figure) need it — the same reason CACHE_WINDOW_DAYS lives in
 * lib/types.ts rather than in lib/db.ts.
 */

/** US dollars per million tokens. Cached input reads at a tenth of input. */
export const PRICE_PER_MTOK: Record<string, { input: number; output: number; cached: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5, cached: 0.1 },
  "claude-sonnet-4-6": { input: 3, output: 15, cached: 0.3 },
  "claude-sonnet-5": { input: 3, output: 15, cached: 0.3 },
  "claude-opus-4-8": { input: 5, output: 25, cached: 0.5 },
  "claude-opus-5": { input: 5, output: 25, cached: 0.5 },
};

/**
 * Rates for a model id, matched by prefix so the dated aliases the environment
 * may carry — `claude-haiku-4-5-20251001` — resolve to their family.
 *
 * An unknown model prices at the most expensive row rather than at zero. A model
 * we have no rate for is a model somebody just set in the environment, and
 * quietly reporting its runs as free is the one wrong answer: it would under-bill
 * every donor and make the cost readout lie in the direction nobody checks.
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
 * `byModel` is what makes this correct: heading alignment runs on Haiku and the
 * claim diff on Sonnet, three times the price, so pricing the summed totals at
 * either rate is wrong in one direction or the other. Rows stored before the
 * breakdown existed have only the totals — those price at the diff model's rate,
 * which is where nearly all of the tokens were, and `costApproximate` says so.
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

/* ---- credits ---- */

/**
 * What one article costs a donor, in cents.
 *
 * Above the token price on purpose. A full three-language comparison runs about
 * 10–15c of tokens, and this also has to cover hosting and the free preview
 * every visitor gets on every uncached article, most of which nobody ever funds.
 * It is not a margin — nothing here is for profit — it is the difference between
 * a donation covering its own run and a donation covering its share of the site.
 */
export const PRICE_PER_ARTICLE_CENTS = 20;

/** What the mock payment grants, once, per account. */
export const MOCK_GRANT_CENTS = 500;

export function articlesFor(cents: number): number {
  return Math.floor(Math.max(0, cents) / PRICE_PER_ARTICLE_CENTS);
}

/** "$3.40" — balances and donation amounts, which are always whole cents. */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
