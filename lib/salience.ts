import type { ArticleSnapshot, Claim, ClaimType, Lang } from "./types";
import { KEY_FACTS_HEADING } from "./types";

/**
 * Which differences are drawn by default, the rest waiting behind "show all".
 *
 * A gap is the cheapest thing to be right about and the least interesting: when
 * one version is four times longer, nearly all of it is missing from the other,
 * and marking every sentence turns the page into one colour. No fixed importance
 * cut-off fixes that, because a long article's extra material is often
 * substantive too: on the Palestinian Legislative Council, gaps scored 2 or more
 * still covered 63% of the English text and 7% of the Arabic. So gaps share a
 * budget per article, spent on the most important first, a paragraph missing as
 * a whole counting as one unit so it is never shown in fragments.
 *
 * Contradictions and framing are rare and are the point of the site; they show
 * unless Jev was unsure or rated them trivial, and do not count against the
 * budget. A contradiction Jev is certain of shows even when trivial: two versions
 * giving a band member different years is still one of them being wrong.
 * Claims without the two numbers come from the Claude engine, which chose its
 * own claims, and always show.
 */
export const SALIENCE = {
  gap: { confidence: 0.6, importance: 1, share: 0.25 },
  other: { confidence: 0.5, importance: 0.5, certain: 0.9 },
};

function bodyLength(article: ArticleSnapshot): number {
  return article.sections.filter((s) => s.heading !== KEY_FACTS_HEADING).reduce((n, s) => n + s.text.length, 0);
}

export function salientClaims(claims: Claim[], articles: Record<string, ArticleSnapshot>): Set<string> {
  const shown = new Set<string>();
  const gaps = new Map<Lang, Claim[]>();

  for (const claim of claims) {
    if (claim.importance === undefined || claim.confidence === undefined) {
      shown.add(claim.id);
    } else if (claim.type !== "unique") {
      const sure = claim.type === "contradiction" && claim.confidence >= SALIENCE.other.certain;
      if (claim.confidence >= SALIENCE.other.confidence && (sure || claim.importance >= SALIENCE.other.importance)) {
        shown.add(claim.id);
      }
    } else if (claim.confidence >= SALIENCE.gap.confidence && claim.importance >= SALIENCE.gap.importance) {
      const lang = Object.keys(claim.spans)[0] as Lang;
      gaps.set(lang, [...(gaps.get(lang) ?? []), claim]);
    }
  }

  for (const [lang, candidates] of gaps) {
    const article = articles[lang];
    if (!article) continue;
    const units = new Map<string, Claim[]>();
    for (const claim of candidates) {
      const key = claim.group ?? claim.id;
      units.set(key, [...(units.get(key) ?? []), claim]);
    }
    const ranked = [...units.values()].sort(
      (a, b) => b[0].importance! - a[0].importance! || b[0].confidence! - a[0].confidence!,
    );
    let budget = SALIENCE.gap.share * bodyLength(article);
    for (const unit of ranked) {
      const length = unit.reduce((n, c) => n + c.spans[lang]!.length, 0);
      if (length > budget) continue;
      budget -= length;
      for (const claim of unit) shown.add(claim.id);
    }
  }
  return shown;
}

/** Differences by kind, a paragraph missing as a whole counting once: it is one
 *  finding, and counted by sentence it would outweigh everything else. */
export function countClaims(claims: Claim[]): Record<ClaimType, number> {
  const counts = { contradiction: 0, unique: 0, framing: 0 };
  const seen = new Set<string>();
  for (const claim of claims) {
    const unit = claim.group ?? claim.id;
    if (seen.has(unit)) continue;
    seen.add(unit);
    counts[claim.type] += 1;
  }
  return counts;
}

/** What the ledger shows for a comparison: the differences drawn by default. */
export function tallyShown(claims: Claim[], articles: Record<string, ArticleSnapshot>): Record<ClaimType, number> {
  const shown = salientClaims(claims, articles);
  return countClaims(claims.filter((c) => shown.has(c.id)));
}
