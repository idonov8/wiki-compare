import type { ArticleSnapshot, CoverageGap, Lang, PreviewCut, Section } from "./types";
import { KEY_FACTS_HEADING } from "./types";

/**
 * Everything in this file runs before any model call and costs nothing.
 * Its job is twofold: produce the coverage diff outright, and narrow the set of
 * section groups the model has to read.
 */

/**
 * Calendar links, not concepts. Bare years and ranges ("1996", "1936–1939") and
 * day-of-year articles ("December 23", "7 October"). Every article links a few
 * of these in passing and which ones differ between editions says nothing about
 * coverage. Labels are fetched in English, so English month names suffice.
 */
const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December";
const CALENDAR_LABEL = new RegExp(
  `^\\s*(?:\\d{1,4}\\s*(?:[–—-]\\s*\\d{1,4}\\s*)?|(?:${MONTHS})\\s+\\d{1,2}|\\d{1,2}\\s+(?:${MONTHS}))\\s*$`,
  "i",
);

/**
 * The coverage diff: the gaps themselves, and the count the summary is written
 * from.
 *
 * `only` is counted over every gap rather than over the returned ones. The list
 * is capped because it is stored; the counts are not, and a summary reading
 * "211 concepts appear only in English" — the coffee article's real figure —
 * off a list of sixty would be reporting the limit rather than the article.
 */
export interface CoverageDiff {
  /** The most lopsided gaps, capped at `limit`. */
  gaps: CoverageGap[];
  /** Per edition, how many concepts only that edition links. */
  only: Partial<Record<Lang, number>>;
}

export function coverageDiff(
  articles: ArticleSnapshot[],
  labels: Map<string, string>,
  limit = 60,
): CoverageDiff {
  const langs = articles.map((a) => a.lang);
  const presence = new Map<string, Set<Lang>>();

  // How early a concept is linked is a decent proxy for how central it is:
  // linkQids preserves the order the links appear in the article, so a concept
  // linked from the lead outranks one linked from the last section.
  const firstSeen = new Map<string, number>();

  for (const article of articles) {
    article.linkQids.forEach((qid, index) => {
      if (!presence.has(qid)) presence.set(qid, new Set());
      presence.get(qid)!.add(article.lang);
      firstSeen.set(qid, Math.min(firstSeen.get(qid) ?? Infinity, index));
    });
  }

  const gaps: CoverageGap[] = [];
  for (const [qid, present] of presence) {
    if (present.size === langs.length) continue;
    const label = labels.get(qid);
    if (!label || CALENDAR_LABEL.test(label)) continue;
    gaps.push({
      qid,
      label,
      presentIn: langs.filter((l) => present.has(l)),
      missingFrom: langs.filter((l) => !present.has(l)),
    });
  }

  const only: Partial<Record<Lang, number>> = {};
  for (const gap of gaps) {
    if (gap.presentIn.length !== 1) continue;
    const lang = gap.presentIn[0];
    only[lang] = (only[lang] ?? 0) + 1;
  }

  // Concepts only one version mentions are the interesting ones, so sort by how
  // lopsided the gap is first. Ties used to break alphabetically, which mattered
  // more than it looks: on a three-language article nearly every gap ties at
  // "missing from two", so the limit was slicing an alphabetical prefix and the
  // panel showed everything from "1923…" to "agriculture…" and nothing later.
  // Break ties on prominence instead, and keep the label as a stable last resort.
  gaps.sort(
    (a, b) =>
      b.missingFrom.length - a.missingFrom.length ||
      (firstSeen.get(a.qid) ?? Infinity) - (firstSeen.get(b.qid) ?? Infinity) ||
      a.label.localeCompare(b.label),
  );

  return { gaps: gaps.slice(0, limit), only };
}

/** Arabic-Indic and Eastern Arabic-Indic digits normalise to ASCII so that
 *  ١٣٢ and 132 compare equal. */
const DIGIT_MAP: Record<string, string> = {};
for (let i = 0; i < 10; i++) {
  DIGIT_MAP[String.fromCharCode(0x0660 + i)] = String(i);
  DIGIT_MAP[String.fromCharCode(0x06f0 + i)] = String(i);
}

export function normaliseDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (d) => DIGIT_MAP[d]);
}

export function extractNumbers(text: string): Set<string> {
  const out = new Set<string>();
  const normalised = normaliseDigits(text);
  for (const match of normalised.matchAll(/\d[\d.,]*/g)) {
    const cleaned = match[0].replace(/[.,]$/, "");
    // Single digits are almost always noise; four-digit years are usually shared.
    if (cleaned.replace(/[.,]/g, "").length >= 2) out.add(cleaned);
  }
  return out;
}

export interface SectionGroup {
  key: string;
  /** Heading as written in each version that has this section. */
  headings: Partial<Record<Lang, string>>;
  sections: Partial<Record<Lang, Section>>;
  reasons: string[];
  /**
   * Where the group sits in the article, in reading order.
   *
   * The lead is -2 and the key-facts block is -1 so that both always lead,
   * whatever the body turns out to look like. For an ordinary group it is the
   * smallest section index among the languages present: an aligned group can sit
   * third in English and seventh in Arabic, and the earliest appearance is the
   * one that decides where a preview boundary lands, because a boundary drawn
   * behind the latest appearance would leave English readers staring at sections
   * the comparison never read.
   */
  order: number;
}

/** Decide which aligned groups are worth a model call. */
export function screenGroups(groups: SectionGroup[], langs: Lang[], limit = 8): SectionGroup[] {
  const scored = groups.map((group) => {
    const reasons: string[] = [];
    const present = langs.filter((l) => group.sections[l]);
    let score = 0;

    if (group.key === "lead") {
      reasons.push("lead");
      score += 100;
    }

    if (group.key === "key-facts") {
      reasons.push("infobox figures");
      score += 90;
    }

    // A baseline for anything comparable at all. Without it, a section present
    // in every language with matching figures and similar length scored exactly
    // zero and was filtered out before the limit was even reached — which is
    // precisely the shape of a framing difference. Contradictions announce
    // themselves numerically and omissions announce themselves by absence, but
    // "West Bank" against "יהודה ושומרון" has neither signal by construction.
    // These still sort last; they just stop being excluded when there is room.
    if (present.length > 1) score += 5;

    if (present.length < langs.length) {
      reasons.push(`absent from ${langs.filter((l) => !group.sections[l]).join(", ")}`);
      score += 30;
    }

    const numberSets = present.map((l) => extractNumbers(group.sections[l]!.text));
    const union = new Set(numberSets.flatMap((s) => [...s]));
    const shared = [...union].filter((n) => numberSets.every((s) => s.has(n)));
    const divergent = union.size - shared.length;
    if (present.length > 1 && divergent > 0) {
      reasons.push(`${divergent} figures not shared by every version`);
      score += Math.min(divergent, 20) * 2;
    }

    const lengths = present.map((l) => group.sections[l]!.text.length);
    if (lengths.length > 1) {
      const ratio = Math.max(...lengths) / Math.max(Math.min(...lengths), 1);
      if (ratio > 2) {
        reasons.push(`${ratio.toFixed(1)}× length difference`);
        score += 15;
      }
    }

    return { ...group, reasons, score };
  });

  return scored
    .filter((g) => g.score > 0 && langs.some((l) => g.sections[l]))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _score, ...group }) => group);
}

/** How much of each article a free preview reads, in characters of body text —
 *  the same budget for every language, so no version is favoured by how its
 *  section structure happens to line up against the others. */
export const PREVIEW_CHARS = 3000;

/** Below this much budget left, stop at the section boundary instead. A heading
 *  followed by a line and a half of text, then the gate, reads as the page
 *  having broken rather than as the preview having ended. */
const MIN_SLICE = 400;

/** `limit` characters of `text`, backed off to the last paragraph break and
 *  failing that the last word break, so a preview never ends mid-word. Both
 *  fallbacks have to keep most of the slice, or a text with one early newline
 *  would cost the preview nearly its whole budget. */
function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const slice = text.slice(0, limit);
  const para = slice.lastIndexOf("\n");
  if (para > limit / 2) return slice.slice(0, para);
  const word = slice.lastIndexOf(" ");
  return word > limit / 2 ? slice.slice(0, word) : slice;
}

/**
 * The opening of an article: the same PREVIEW_CHARS characters of body text in
 * every language, plus the key facts, as a snapshot the ordinary comparison
 * machinery can be pointed at unchanged.
 *
 * A prefix rather than the most divergent parts of the article, because the
 * interface fades the columns out past the point the comparison stopped and a
 * fade only means anything if everything above it was read. Divergence scoring
 * is still what a full run wants — `screenGroups` — since it covers the whole
 * article anyway and is free to jump around inside it.
 *
 * The key-facts block is outside the budget and outside the cut: it sits above
 * the columns rather than in them, so nothing it costs is visible as depth on
 * the page, and a long infobox should not be able to spend a preview before the
 * lead has been read.
 */
export function previewOf(
  article: ArticleSnapshot,
  budget = PREVIEW_CHARS,
): { article: ArticleSnapshot; cut: PreviewCut } {
  const sections: Section[] = [];
  let cut: PreviewCut = { section: 0, chars: 0 };
  let left = budget;
  let index = 0;

  for (const section of article.sections) {
    if (section.heading === KEY_FACTS_HEADING) {
      sections.push(section);
      continue;
    }
    if (left < MIN_SLICE) break;

    const text = clip(section.text, left);
    if (text.length === section.text.length) {
      sections.push(section);
      cut = { section: index + 1, chars: 0 };
      left -= text.length;
      index++;
      continue;
    }

    // The budget ran out inside this section. Links are dropped rather than
    // kept: their offsets index the full text, and one reaching past the cut
    // would point at characters this copy no longer has.
    sections.push({ ...section, text, links: section.links?.filter((l) => l.end <= text.length) });
    cut = { section: index, chars: text.length };
    break;
  }

  return { article: { ...article, sections }, cut };
}
