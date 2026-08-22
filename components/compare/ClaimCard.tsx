"use client";

import type { CardState } from "./types";
import type { Claim } from "@/lib/types";

const KIND_LABEL: Record<Claim["type"], string> = {
  contradiction: "Contradiction",
  unique: "Only in one version",
  framing: "Different framing",
};

/** What a mark says when the pointer or the keyboard reaches it. Positioned by
 *  useClaimCard, which is also where it learns to get out of its own way. */
export default function ClaimCard({ card }: { card: CardState }) {
  return (
    <div
      className="card fixed z-50 max-w-[min(340px,calc(100vw_-_16px))] px-[15px] py-[13px] bg-paper-raised border border-ink rounded-[2px] shadow-offset pointer-events-none [direction:ltr] text-start"
      id="claim-card"
      style={{ left: card.left, top: card.top, bottom: card.bottom }}
      role="tooltip"
    >
      <span
        className="kind font-mono text-[10px] tracking-[0.09em] uppercase block mb-[5px] data-[type=contradiction]:text-contradiction data-[type=unique]:text-unique data-[type=framing]:text-framing"
        data-type={card.claim.type}
      >
        {KIND_LABEL[card.claim.type]}
      </span>
      <span className="summary font-semibold block mb-[5px]">{card.claim.summary}</span>
      <span className="explanation text-[14px] leading-[1.55] text-ink-soft">
        {card.claim.explanation}
      </span>
      <div className="also font-mono text-[11px] text-ink-soft mt-[9px] pt-[8px] border-t border-rule">
        marked in{" "}
        {Object.keys(card.claim.spans)
          .map((l) => l.toUpperCase())
          .join(", ")}
      </div>
    </div>
  );
}
