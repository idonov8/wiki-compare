"use client";

import type { Claim, Lang } from "@/lib/types";
import { ghostRanges } from "@/lib/ghost";

interface Range {
  start: number;
  end: number;
  claim: Claim;
}

/** Locate each claim's verbatim snippet in this block of text. Overlapping hits
 *  are resolved in favour of the longer span so nested quotes don't nest marks. */
function locate(text: string, lang: Lang, claims: Claim[]): Range[] {
  const found: Range[] = [];

  for (const claim of claims) {
    const snippet = claim.spans[lang];
    if (!snippet) continue;
    const start = text.indexOf(snippet);
    if (start === -1) continue;
    found.push({ start, end: start + snippet.length, claim });
  }

  found.sort((a, b) => a.start - b.start || b.end - a.end);

  const kept: Range[] = [];
  for (const range of found) {
    if (!kept.length || range.start >= kept[kept.length - 1].end) kept.push(range);
  }
  return kept;
}

const GHOST_TYPES: Claim["type"][] = ["contradiction", "unique", "framing"];

export default function Highlighted({
  text,
  lang,
  claims,
  ghost = false,
  activeId = null,
  onEnter,
  onLeave,
}: {
  text: string;
  lang: Lang;
  claims: Claim[];
  ghost?: boolean;
  activeId?: string | null;
  onEnter?: (claim: Claim, event: React.MouseEvent | React.FocusEvent) => void;
  onLeave?: () => void;
}) {
  if (ghost) {
    const nodes: React.ReactNode[] = [];
    let at = 0;
    for (const { start, end, seed } of ghostRanges(text)) {
      nodes.push(text.slice(at, start));
      nodes.push(
        <mark
          key={start}
          className="ghost"
          data-type={GHOST_TYPES[seed % 3]}
          style={{
            animationDuration: `${4 + ((seed >> 3) % 45) / 10}s`,
            animationDelay: `-${((seed >> 7) % 90) / 10}s`,
          }}
        >
          {text.slice(start, end)}
        </mark>,
      );
      at = end;
    }
    nodes.push(text.slice(at));
    return <span className="body-text">{nodes}</span>;
  }

  const ranges = locate(text, lang, claims);
  if (!ranges.length) return <span className="body-text">{text}</span>;

  const nodes: React.ReactNode[] = [];
  let cursor = 0;

  ranges.forEach((range, i) => {
    if (range.start > cursor) nodes.push(text.slice(cursor, range.start));
    nodes.push(
      <mark
        key={`${range.claim.id}-${i}`}
        className="claim"
        tabIndex={0}
        role="button"
        aria-describedby={activeId === range.claim.id ? "claim-card" : undefined}
        aria-label={`${range.claim.type}: ${range.claim.summary}`}
        data-type={range.claim.type}
        data-active={activeId === range.claim.id}
        onMouseEnter={(e) => onEnter?.(range.claim, e)}
        onFocus={(e) => onEnter?.(range.claim, e)}
        onMouseLeave={onLeave}
        onBlur={onLeave}
      >
        {text.slice(range.start, range.end)}
      </mark>,
    );
    cursor = range.end;
  });

  if (cursor < text.length) nodes.push(text.slice(cursor));

  return <span className="body-text">{nodes}</span>;
}
