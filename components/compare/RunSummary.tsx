"use client";

import ClaimRatio, { claimsSaid, countClaims } from "../ClaimRatio";
import type { Claim, ComparePayload } from "@/lib/types";

/**
 * A processed article: what the run found, in the proportions the ledger draws
 * it in, the same line a reader may have pressed to get here. No count beside the line: the marks are on the page
 * under it, and the proportion is the reading the number was standing in for.
 */
export default function RunSummary({
  claims,
  /** Absent while the run is still reading. */
  data,
}: {
  claims: Claim[];
  data: ComparePayload | null;
}) {
  const counts = countClaims(claims);

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
      {!data && (
        <span className="meta-progress ml-auto min-w-0 max-cols:truncate max-tight:text-[11px]">
          {claims.length ? "still reading…" : "reading all three…"}
        </span>
      )}
    </>
  );
}
