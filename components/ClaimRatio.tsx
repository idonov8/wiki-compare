import type { Claim, ClaimType } from "@/lib/types";

/** The three inks, in the order the legend prints them. `noun` is written after
 *  a count, so it is already the shape a plural takes. */
export const CLAIM_KINDS: { kind: ClaimType; fill: string; noun: string }[] = [
  { kind: "contradiction", fill: "bg-contradiction", noun: "contradictions" },
  { kind: "unique", fill: "bg-unique", noun: "only in one version" },
  { kind: "framing", fill: "bg-framing", noun: "different framing" },
];

export type ClaimCounts = Record<ClaimType, number>;

export const countClaims = (claims: Claim[]): ClaimCounts =>
  claims.reduce(
    (counts, claim) => ({ ...counts, [claim.type]: counts[claim.type] + 1 }),
    { contradiction: 0, unique: 0, framing: 0 } as ClaimCounts,
  );

export const claimsSaid = (counts: ClaimCounts): string =>
  CLAIM_KINDS.filter(({ kind }) => counts[kind])
    .map(({ kind, noun }) => `${counts[kind]} ${noun}`)
    .join(", ") || "no differences found";

/**
 * What kind of differences a run found, as one line divided in proportion.
 *
 * Counts, not lengths: the line says a run was mostly contradictions or mostly
 * framing, which is the character of a disagreement rather than its size. The
 * empty track stays visible when nothing was found, because a line that drew
 * nothing would read as a comparison that was never read.
 *
 * Shared by the ledger, where it is one row's reading, and by the strip above a
 * comparison, where it is the same reading of the article on screen — the two
 * drawing the proportion differently would make the ledger unreadable as a
 * preview of the thing it links to.
 */
export default function ClaimRatio({
  counts,
  className = "",
  delay = 0,
  title,
}: {
  counts: ClaimCounts;
  /** The track's size, which differs between the ledger and the strip. */
  className?: string;
  delay?: number;
  title?: string;
}) {
  return (
    <span
      className={`recent-ratio flex origin-left animate-line-draw gap-px bg-ink-wash ${className}`}
      title={title ?? claimsSaid(counts)}
      style={{ animationDelay: `${delay}ms` }}
      aria-hidden
    >
      {CLAIM_KINDS.filter(({ kind }) => counts[kind]).map(({ kind, fill }) => (
        <span key={kind} className={fill} style={{ flex: `${counts[kind]} 0 0%` }} />
      ))}
    </span>
  );
}
