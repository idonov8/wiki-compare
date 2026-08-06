"use client";

import type { Claim, Lang, LinkSpan } from "@/lib/types";
import { ghostRanges } from "@/lib/ghost";

interface Range {
  start: number;
  end: number;
  /** A located claim, or — while a comparison runs — a drifting ghost's seed. */
  claim?: Claim;
  seed?: number;
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

/** Build our own comparison URL for a linked article, carrying the source
 *  language so a Hebrew or Arabic title resolves against the right wiki. */
export function comparePath(title: string, lang: string): string {
  return `/?title=${encodeURIComponent(title)}&lang=${lang}`;
}

const GHOST_TYPES: Claim["type"][] = ["contradiction", "unique", "framing"];

export default function Highlighted({
  text,
  lang,
  claims,
  links = [],
  ghost = false,
  activeId = null,
  onEnter,
  onLeave,
  onLink,
}: {
  text: string;
  lang: Lang;
  claims: Claim[];
  links?: LinkSpan[];
  ghost?: boolean;
  activeId?: string | null;
  onEnter?: (claim: Claim, event: React.MouseEvent | React.FocusEvent) => void;
  onLeave?: () => void;
  onLink?: (title: string, lang: Lang) => void;
}) {
  const ranges: Range[] = ghost ? ghostRanges(text) : locate(text, lang, claims);
  if (!ranges.length && !links.length) return <span className="body-text">{text}</span>;

  // Split at every claim and link boundary, then merge neighbouring atoms that
  // share the same claim and link so a claim with no link inside stays one mark.
  const bounds = new Set<number>([0, text.length]);
  for (const r of ranges) bounds.add(r.start).add(r.end);
  for (const l of links) bounds.add(l.start).add(l.end);
  const cuts = [...bounds].sort((a, b) => a - b);

  const markAt = (i: number) => ranges.find((r) => i >= r.start && i < r.end);
  const linkAt = (i: number) => links.find((l) => i >= l.start && i < l.end);

  const nodes: React.ReactNode[] = [];
  for (let k = 0; k < cuts.length - 1; k++) {
    const from = cuts[k];
    const to = cuts[k + 1];
    if (to <= from) continue;
    const mark = markAt(from);
    const link = linkAt(from);

    let node: React.ReactNode = text.slice(from, to);
    if (link) {
      node = (
        <a
          href={comparePath(link.title, lang)}
          className="wikilink"
          onClick={(e) => {
            // Let modifier/middle clicks open a new tab; take over the plain one.
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onLink?.(link.title, lang);
          }}
        >
          {node}
        </a>
      );
    }
    if (mark?.claim) {
      const found = mark.claim;
      node = (
        <mark
          className="claim"
          tabIndex={0}
          role="button"
          aria-describedby={activeId === found.id ? "claim-card" : undefined}
          aria-label={`${found.type}: ${found.summary}`}
          data-type={found.type}
          data-active={activeId === found.id}
          onMouseEnter={(e) => onEnter?.(found, e)}
          onFocus={(e) => onEnter?.(found, e)}
          onMouseLeave={onLeave}
          onBlur={onLeave}
        >
          {node}
        </mark>
      );
    } else if (mark?.seed !== undefined) {
      // Same span machinery, so a link inside a drifting mark stays a link: the
      // article is meant to be read and followed while the model reads it too.
      const { seed } = mark;
      node = (
        <mark
          className="ghost"
          data-type={GHOST_TYPES[seed % 3]}
          style={{
            animationDuration: `${4 + ((seed >> 3) % 45) / 10}s`,
            animationDelay: `-${((seed >> 7) % 90) / 10}s`,
          }}
        >
          {node}
        </mark>
      );
    }
    nodes.push(<span key={from}>{node}</span>);
  }

  return <span className="body-text">{nodes}</span>;
}
