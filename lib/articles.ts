import { LANGS, type ArticleSnapshot, type Lang, type Source } from "./types";
import {
  PARSER_VERSION,
  currentRevid,
  fetchArticle,
  fetchRevisionHtml,
  resolveSitelinks,
} from "./wikipedia";
import { SOURCES_VERSION, parseSources } from "./sources";
import { getArticle, getSources, putArticle, putSources } from "./db";

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

/**
 * A recorded fixture standing in for a revision, so the sources panel renders
 * offline.
 *
 * Development only, and matched on revision id rather than on a `demo:` prefix:
 * the client asks for sources by the revids it has on screen and knows nothing
 * about where they came from, so the fixture has to answer to the same question
 * a real article does. Dead code in production, where the import never runs.
 */
async function fixtureHtml(lang: Lang, revid: number): Promise<string | null> {
  if (process.env.NODE_ENV === "production") return null;
  try {
    const { listFixtures, loadFixture } = await import("../fixtures/loader");
    for (const slug of listFixtures()) {
      const page = loadFixture(slug).pages[lang];
      if (page?.revid === revid) return page.text;
    }
  } catch {
    // No fixtures on disk is not a failure; the revision is fetched instead.
  }
  return null;
}

/**
 * The footnotes of one revision, parsed once and then cached forever.
 *
 * Sources are read on demand rather than folded into `snapshotsFor`, because
 * they are keyed on nothing the comparison is keyed on: a comparison cached
 * before this existed still describes its revisions exactly, and re-reading
 * hundreds of stored articles to attach a reference list to them would have
 * meant paying the model again for every one of them. So the list is fetched
 * beside the comparison, for whatever revisions the columns ended up showing.
 */
export async function sourcesFor(lang: Lang, revid: number): Promise<Source[]> {
  const hit = await cached(() => getSources(lang, revid, SOURCES_VERSION));
  if (hit) return hit;
  const html = (await fixtureHtml(lang, revid)) ?? (await fetchRevisionHtml(lang, revid));
  const sources = parseSources(html);
  await cached(() => putSources(lang, revid, SOURCES_VERSION, sources));
  return sources;
}
