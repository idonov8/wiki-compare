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

/** Locate each claim's snippet in this block of text: at its exact ref when the
 *  claim carries one, since a sentence can appear in both the lead and the body,
 *  and by search otherwise. Overlapping hits are resolved in favour of the
 *  longer span so nested quotes don't nest marks. */
function locate(text: string, lang: Lang, claims: Claim[], section?: number): Range[] {
  const found: Range[] = [];

  for (const claim of claims) {
    const snippet = claim.spans[lang];
    if (!snippet) continue;
    const ref = claim.refs?.[lang];
    if (ref && section !== undefined) {
      if (ref.section === section && text.slice(ref.start, ref.end) === snippet) {
        found.push({ start: ref.start, end: ref.end, claim });
      }
      continue;
    }
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

/** A mark's band at the strength the engine was sure of it, for the engines
 *  that say. Never fainter than a quarter, so an unsure mark is still a mark;
 *  the active mark keeps its full colour from the stylesheet. */
function confidenceStyle(claim: Claim, active: boolean): React.CSSProperties | undefined {
  if (claim.confidence === undefined || active) return undefined;
  const strength = Math.round(25 + 75 * Math.min(1, Math.max(0, claim.confidence)));
  return {
    backgroundColor: `color-mix(in srgb, var(--color-mark-${claim.type}) ${strength}%, transparent)`,
  };
}

/** A sentence the reader can point at to see where it sits in the other
 *  languages, as a range of this block's text. */
export interface SentenceTarget {
  start: number;
  end: number;
  key: string;
}

export default function Highlighted({
  text,
  lang,
  claims,
  links = [],
  ghost = false,
  activeId = null,
  section,
  sentences = [],
  activeSentence = null,
  onEnter,
  onLeave,
  onLink,
  onSentence,
  onSentenceLeave,
}: {
  text: string;
  lang: Lang;
  claims: Claim[];
  links?: LinkSpan[];
  ghost?: boolean;
  activeId?: string | null;
  /** This block's index among the article's sections, for locating by ref. */
  section?: number;
  sentences?: SentenceTarget[];
  activeSentence?: string | null;
  onEnter?: (claim: Claim, event: React.MouseEvent | React.FocusEvent) => void;
  onLeave?: () => void;
  onLink?: (title: string, lang: Lang) => void;
  onSentence?: (key: string, element: HTMLElement, how: "hover" | "tap") => void;
  onSentenceLeave?: () => void;
}) {
  const ranges: Range[] = ghost ? ghostRanges(text) : locate(text, lang, claims, section);
  const targets = ghost ? [] : sentences;
  if (!ranges.length && !links.length && !targets.length)
    return (
      <span className="body-text whitespace-pre-wrap font-wiki text-[14.5px] leading-[1.62] text-wiki-text">
        {text}
      </span>
    );

  // Split at every claim and link boundary, then merge neighbouring atoms that
  // share the same claim and link so a claim with no link inside stays one mark.
  const bounds = new Set<number>([0, text.length]);
  for (const r of ranges) bounds.add(r.start).add(r.end);
  for (const l of links) bounds.add(l.start).add(l.end);
  for (const t of targets) bounds.add(t.start).add(t.end);
  const cuts = [...bounds].sort((a, b) => a - b);

  const markAt = (i: number) => ranges.find((r) => i >= r.start && i < r.end);
  const linkAt = (i: number) => links.find((l) => i >= l.start && i < l.end);

  const sentenceAt = (i: number) => targets.find((t) => i >= t.start && i < t.end);
  const nodes: { node: React.ReactNode; sentence?: SentenceTarget }[] = [];
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
          className="wikilink text-wiki-link no-underline hover:underline"
          // Disabled for now, along with the coverage panel that read it — see
          // Compare.tsx. Was `data-qid={link.qid}`, targeting a concept's first
          // mention by the Wikidata id its title resolved to.
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
        // A filled band in the difference's colour, carried across line breaks
        // with box-decoration-clone so a wrapped span reads as one mark. No
        // inline padding: it is what would open a gap between the fragments a
        // span splits into at an LTR/RTL boundary, so the fill stays continuous
        // across direction changes. A darker inset shadow under the band keeps
        // the type legible without relying on the fill colour alone.
        <mark
          className="claim text-wiki-text bg-transparent rounded-[2px] py-[0.09em] box-decoration-clone cursor-help transition-[background-color] duration-[120ms] ease-[ease] data-[type=contradiction]:bg-mark-contradiction data-[type=contradiction]:inset-shadow-contradiction data-[type=unique]:bg-mark-unique data-[type=unique]:inset-shadow-unique data-[type=framing]:bg-mark-framing data-[type=framing]:inset-shadow-framing data-[active=true]:data-[type=contradiction]:bg-mark-contradiction-on data-[active=true]:data-[type=unique]:bg-mark-unique-on data-[active=true]:data-[type=framing]:bg-mark-framing-on"
          tabIndex={0}
          role="button"
          aria-describedby={activeId === found.id ? "claim-card" : undefined}
          aria-label={`${found.type}: ${found.summary}`}
          data-type={found.type}
          data-active={activeId === found.id}
          style={confidenceStyle(found, activeId === found.id)}
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
      const ghostType = GHOST_TYPES[seed % 3];
      node = (
        // Not a finding and never mistakable for one: no rule under the band,
        // no cursor and no hover, and it fades in and out on a staggered cycle
        // (driven by the animate-ghost-drift keyframes) so the page reads as
        // being worked over rather than as already marked up. `--ghost` feeds
        // the keyframes' mid-cycle background colour; duration and delay vary
        // per mark, so they're set here rather than in the shared utility.
        <mark
          className="ghost text-inherit bg-transparent rounded-[2px] py-[0.09em] box-decoration-clone animate-ghost-drift"
          data-type={ghostType}
          style={
            {
              "--ghost": `var(--color-ghost-${ghostType})`,
              animationDuration: `${4 + ((seed >> 3) % 45) / 10}s`,
              animationDelay: `-${((seed >> 7) % 90) / 10}s`,
            } as React.CSSProperties
          }
        >
          {node}
        </mark>
      );
    }
    nodes.push({ node: <span key={from}>{node}</span>, sentence: sentenceAt(from) });
  }

  // Consecutive pieces of one sentence share a wrapper, which is what the pointer
  // enters; the marks and links inside it keep their own behaviour.
  const grouped: React.ReactNode[] = [];
  for (let k = 0; k < nodes.length; ) {
    const sentence = nodes[k].sentence;
    if (!sentence) {
      grouped.push(nodes[k].node);
      k++;
      continue;
    }
    const run: React.ReactNode[] = [];
    while (k < nodes.length && nodes[k].sentence === sentence) run.push(nodes[k++].node);
    grouped.push(
      <span
        key={`s${sentence.start}`}
        className="sentence rounded-[2px] box-decoration-clone transition-[background-color,box-shadow] duration-[120ms] data-[active=true]:bg-wiki-shade"
        data-sentence={sentence.key}
        data-active={activeSentence === sentence.key}
        onMouseEnter={(e) => onSentence?.(sentence.key, e.currentTarget, "hover")}
        onMouseLeave={onSentenceLeave}
        onClick={(e) => onSentence?.(sentence.key, e.currentTarget, "tap")}
      >
        {run}
      </span>,
    );
  }

  return (
    <span className="body-text whitespace-pre-wrap font-wiki text-[14.5px] leading-[1.62] text-wiki-text">
      {grouped}
    </span>
  );
}
