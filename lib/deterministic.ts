import type { ArticleSnapshot, CoverageGap, Lang, Section } from "./types";

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

export function coverageGaps(
  articles: ArticleSnapshot[],
  labels: Map<string, string>,
  limit = 60,
): CoverageGap[] {
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

  // Concepts only one version mentions are the interesting ones, so sort by how
  // lopsided the gap is first. Ties used to break alphabetically, which mattered
  // more than it looks: on a three-language article nearly every gap ties at
  // "missing from two", so the limit was slicing an alphabetical prefix and the
  // panel showed everything from "1923…" to "agriculture…" and nothing later.
  // Break ties on prominence instead, and keep the label as a stable last resort.
  return gaps
    .sort(
      (a, b) =>
        b.missingFrom.length - a.missingFrom.length ||
        (firstSeen.get(a.qid) ?? Infinity) - (firstSeen.get(b.qid) ?? Infinity) ||
        a.label.localeCompare(b.label),
    )
    .slice(0, limit);
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
