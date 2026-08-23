"use client";

import ClaimRatio, { claimsSaid, countClaims } from "../ClaimRatio";
import { formatCost, storedCost } from "@/lib/pricing";
import type { Claim, ComparePayload } from "@/lib/types";

/**
 * What this comparison cost somebody.
 *
 * A cache hit is not free and must never say so. Somebody paid to have this
 * article read, and everyone arriving after them reads it for nothing — that
 * exchange is the whole argument this site makes for donating, and printing
 * "free" at the end of it threw the argument away.
 *
 * Most stored comparisons predate costs being recorded, so most of the time the
 * figure is `storedCost`'s estimate from the token totals rather than the price
 * struck on the day. That is worth saying and worth marking: "about $0.18" reads
 * as an estimate on sight, without a legend. Only a run with no usable totals at
 * all says nothing — there, any number would be invented.
 */
function costNote(data: ComparePayload): string | null {
  const cost = storedCost(data.usage);
  if (!cost) return null;
  const amount = cost.approximate
    ? // "about <$0.01" is nonsense; under a cent, the bound is the estimate.
      cost.usd < 0.01
      ? "under $0.01"
      : `about ${formatCost(cost.usd)}`
    : formatCost(cost.usd);
  return data.fromCache
    ? `${amount} was paid to process this article`
    : `${amount} to process this article`;
}

/**
 * A processed article: what the run found, in the proportions the ledger draws
 * it in — the same line a reader may have pressed to get here — and what
 * somebody paid for it. No count beside the line: the marks are on the page
 * under it, and the proportion is the reading the number was standing in for.
 */
export default function RunSummary({
  claims,
  /** Absent while the run is still reading, when there is no cost to name yet. */
  data,
}: {
  claims: Claim[];
  data: ComparePayload | null;
}) {
  const counts = countClaims(claims);
  const cost = data && costNote(data);

  return (
    <>
      {/* Padded onto a hairline of its own, so the line stands on the same axis
          the length chart's bars do further along the strip.
          Once the chart and the key have the strip's width to themselves, the
          line takes a row of its own under them and runs the full width: beside
          the key it was reduced to a forty-pixel stub, which is a proportion
          nobody can read. On its own row it needs no hairline either — there is
          no bar left to share an axis with, and a rule across the whole strip
          would read as a divider rather than as the ground the line stands on. */}
      <span className="inline-flex grow border-b border-rule pb-[4px] max-cols:basis-full max-cols:border-b-0 max-cols:pb-0">
        <ClaimRatio
          counts={counts}
          className="h-[7px] w-full"
          delay={140}
          title={data ? claimsSaid(counts) : `${claimsSaid(counts)} so far`}
        />
      </span>
      {/* Truncating from the width the columns break at rather than only on the
          narrowest screens: past that the cost line shares its row with the
          cached badge, and a line that grows instead of cutting pushes the badge
          onto a row of its own. */}
      {data ? (
        cost && (
          <span className="meta-cost ml-auto min-w-0 max-cols:truncate max-tight:text-[11px]">{cost}</span>
        )
      ) : (
        <span className="meta-cost ml-auto min-w-0 max-cols:truncate max-tight:text-[11px]">
          {claims.length ? "still reading…" : "reading all three…"}
        </span>
      )}
    </>
  );
}
