import type { ArticleSnapshot, Lang } from "../types";
import { KEY_FACTS_HEADING } from "../types";

/**
 * A run of one section's text, as character offsets into `Section.text`.
 *
 * Offsets rather than copied strings because the highlighter finds a claim by
 * searching the section for its span: a unit that is a true slice of the section
 * is found by construction, which is the property the model-quoted spans of the
 * Claude engine never had.
 */
export interface Unit {
  section: number;
  heading: string;
  start: number;
  end: number;
  text: string;
}

export interface Paragraph extends Unit {
  id: string;
  /** Infobox lines are matched only against infobox lines, and prose only
   *  against prose: a body paragraph scored against "Seats: 132" is noise. */
  kind: "body" | "facts";
  sentences: Unit[];
}

export interface Segmented {
  lang: Lang;
  title: string;
  paragraphs: Paragraph[];
}

/** Below this, a line is a list item, a caption or a lead-in, and belongs to the
 *  paragraph around it rather than being matched on its own. */
export const MIN_PARAGRAPH = 80;
/** A list item up to this long stays in the list its lead-in opened; a longer
 *  one is a point in its own right. */
const MAX_LIST_ITEM = 120;
/** Shorter sentences are fragments ("Type", "History") with nothing to compare. */
export const MIN_SENTENCE = 15;
const MIN_FACT = 6;

const LEADING = /^[\s•·*\-–—]+/u;
const TRAILING = /\s+$/u;

function trimmed(text: string, start: number, end: number): { start: number; end: number } | null {
  const slice = text.slice(start, end);
  const lead = slice.match(LEADING)?.[0].length ?? 0;
  const trail = slice.match(TRAILING)?.[0].length ?? 0;
  const s = start + lead;
  const e = end - trail;
  return e > s ? { start: s, end: e } : null;
}

function lines(text: string): { start: number; end: number; bullet: boolean }[] {
  const out: { start: number; end: number; bullet: boolean }[] = [];
  for (const m of text.matchAll(/[^\n]+/g)) {
    const t = trimmed(text, m.index, m.index + m[0].length);
    if (t) out.push({ ...t, bullet: /^\s*[•·*]/u.test(m[0]) });
  }
  return out;
}

function sentencesOf(text: string, start: number, end: number, lang: Lang, section: number, heading: string): Unit[] {
  const segmenter = new Intl.Segmenter(lang, { granularity: "sentence" });
  const out: Unit[] = [];
  for (const seg of segmenter.segment(text.slice(start, end))) {
    const t = trimmed(text, start + seg.index, start + seg.index + seg.segment.length);
    if (!t || t.end - t.start < MIN_SENTENCE) continue;
    out.push({ section, heading, ...t, text: text.slice(t.start, t.end) });
  }
  return out;
}

/**
 * Prose paragraphs and infobox lines, each with its sentences.
 *
 * A short line joins the paragraph before it, and a paragraph still short of
 * MIN_PARAGRAPH absorbs the line after it. A line ending in a colon opens a
 * list, and the bullets after it stay in that paragraph, so "The seats were
 * divided as follows:" and its items are one unit. A long bullet stays its own
 * paragraph: each of those is a separate point.
 */
export function segment(article: ArticleSnapshot): Segmented {
  const paragraphs: Paragraph[] = [];
  const push = (kind: Paragraph["kind"], section: number, heading: string, start: number, end: number, text: string) => {
    const sentences =
      kind === "facts"
        ? [{ section, heading, start, end, text: text.slice(start, end) }]
        : sentencesOf(text, start, end, article.lang, section, heading);
    if (!sentences.length) return;
    paragraphs.push({
      id: `p${paragraphs.length}`,
      kind,
      section,
      heading,
      start,
      end,
      text: text.slice(start, end),
      sentences,
    });
  };

  article.sections.forEach((section, index) => {
    const { text, heading } = section;
    if (heading === KEY_FACTS_HEADING) {
      for (const line of lines(text)) {
        const value = text.slice(line.start, line.end);
        if (value.length >= MIN_FACT && (value.includes(":") || value.length >= 30)) {
          push("facts", index, heading, line.start, line.end, text);
        }
      }
      return;
    }

    let current: { start: number; end: number } | null = null;
    let listOpen = false;
    const flush = () => {
      if (current) push("body", index, heading, current.start, current.end, text);
      current = null;
    };
    for (const line of lines(text)) {
      const length = line.end - line.start;
      const listItem = listOpen && line.bullet && length <= MAX_LIST_ITEM;
      if (current && (listItem || length < MIN_PARAGRAPH || current.end - current.start < MIN_PARAGRAPH)) {
        current.end = line.end;
      } else {
        flush();
        current = { start: line.start, end: line.end };
      }
      if (!listItem) listOpen = /[:：]$/u.test(text.slice(line.start, line.end));
    }
    flush();
  });

  return { lang: article.lang, title: article.title, paragraphs };
}

/** The paragraph a sentence (or any slice) of `s` falls in. */
export function paragraphOf(s: Segmented, u: { section: number; start: number; end: number }): Paragraph | undefined {
  return s.paragraphs.find((p) => p.section === u.section && p.start <= u.start && p.end >= u.end);
}
