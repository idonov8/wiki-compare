import { LANGS, type ArticleSnapshot, type Lang } from "./types";
import { PARSER_VERSION, currentRevid, fetchArticle, resolveSitelinks } from "./wikipedia";
import { getArticle, putArticle } from "./db";

/**
 * Everything both the preview and the comparison need before any model runs:
 * which Wikidata item the title is, what it is called in each language, and the
 * current revision of each. Revisions come first because they are three tiny
 * calls that decide every cache hit downstream.
 */
export async function resolveTarget(title: string, lang: string) {
  const { qid, titles } = await resolveSitelinks(title, lang);
  const available = LANGS.filter((l) => titles[l]);

  if (available.length < 2) {
    throw new Error(
      `${qid} only exists in ${available.join(", ") || "none"} of the three languages, so there is nothing to compare.`,
    );
  }

  const revids: Record<string, number> = {};
  await Promise.all(
    available.map(async (l) => {
      const revid = await currentRevid(l, titles[l]!);
      if (revid) revids[l] = revid;
    }),
  );

  return { qid, titles, revids, langs: available.filter((l) => revids[l]) };
}

/** The article cache is an optimisation, not a dependency: reading the articles
 *  needs Wikipedia and nothing else, so a missing or unreachable DATABASE_URL
 *  costs a re-fetch rather than the page. Logged, never swallowed silently. */
async function cached<T>(op: () => Promise<T>): Promise<T | null> {
  try {
    return await op();
  } catch (error) {
    console.warn("article cache unavailable:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function snapshotsFor(
  langs: Lang[],
  titles: Partial<Record<Lang, string>>,
  revids: Record<string, number>,
): Promise<ArticleSnapshot[]> {
  return Promise.all(
    langs.map(async (lang) => {
      const hit = await cached(() => getArticle(lang, revids[lang], PARSER_VERSION));
      if (hit) return hit;
      const fresh = await fetchArticle(lang, titles[lang]!);
      await cached(() => putArticle(fresh, PARSER_VERSION));
      return fresh;
    }),
  );
}
