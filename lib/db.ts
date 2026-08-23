import { neon } from "@neondatabase/serverless";
import { PROMPT_VERSION } from "./compare";
import {
  LANGS,
  type ArticleSnapshot,
  type ComparisonResult,
  type Lang,
  type RecentArticle,
  type ScopeKind,
  type Source,
} from "./types";
import { PARSER_VERSION } from "./wikipedia";

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Add it in the Vercel project settings.");
  return neon(url);
}

/**
 * Two caches, both write-once.
 *
 * Wikipedia revision ids are immutable, so neither cache ever needs an
 * invalidation pass. Keying article text on revid alone means an edit to the
 * Hebrew page does not invalidate the English or Arabic fetch. Keying the
 * comparison on all three revids plus the prompt version means the model runs
 * again only when an article actually changed or the prompt did.
 *
 * Reads are looser than writes: a stored comparison keeps answering after the
 * revisions it was computed from have moved on, until somebody pays to have the
 * article read again. See `getCachedComparison`.
 */

export async function getArticle(
  lang: Lang,
  revid: number,
  parserVersion: string,
): Promise<ArticleSnapshot | null> {
  const rows = await sql()`
    SELECT snapshot FROM articles
    WHERE lang = ${lang} AND revid = ${revid} AND parser_version = ${parserVersion}
    LIMIT 1
  `;
  return rows.length ? (rows[0].snapshot as ArticleSnapshot) : null;
}

export async function putArticle(snapshot: ArticleSnapshot, parserVersion: string): Promise<void> {
  await sql()`
    INSERT INTO articles (lang, revid, parser_version, title, snapshot)
    VALUES (${snapshot.lang}, ${snapshot.revid}, ${parserVersion}, ${snapshot.title}, ${JSON.stringify(snapshot)})
    ON CONFLICT (lang, revid, parser_version) DO NOTHING
  `;
}

/**
 * The footnotes of one revision.
 *
 * A third cache of the same shape as the two above, and separate from them for
 * the same reason they are separate from each other: a sources list is read out
 * of the part of the page the article parser throws away, so nothing about it
 * changes when the parser or the prompt does. Folded into `articles`, every
 * change to either version would have thrown away a comparison to re-read a
 * reference list that had not changed a character.
 */
export async function getSources(
  lang: Lang,
  revid: number,
  sourcesVersion: string,
): Promise<Source[] | null> {
  const rows = await sql()`
    SELECT sources FROM article_sources
    WHERE lang = ${lang} AND revid = ${revid} AND sources_version = ${sourcesVersion}
    LIMIT 1
  `;
  return rows.length ? (rows[0].sources as Source[]) : null;
}

export async function putSources(
  lang: Lang,
  revid: number,
  sourcesVersion: string,
  sources: Source[],
): Promise<void> {
  await sql()`
    INSERT INTO article_sources (lang, revid, sources_version, sources)
    VALUES (${lang}, ${revid}, ${sourcesVersion}, ${JSON.stringify(sources)})
    ON CONFLICT (lang, revid, sources_version) DO NOTHING
  `;
}

/**
 * The scope belongs in the key.
 *
 * A preview and a full run describe the same revisions of the same subject and
 * are not the same answer — one read the first few sections and the other read
 * the whole article. Sharing a key would mean whichever ran first wins forever:
 * a preview would satisfy the cache on every later request and the funded full
 * run would have nowhere to be stored, so somebody would pay for a comparison
 * nobody could ever be served. They are separate rows, and `getCachedComparison`
 * is what decides which of them a reader gets.
 */
export function comparisonKey(
  qid: string,
  revids: Record<string, number>,
  promptVersion: string,
  parserVersion: string,
  scope: ScopeKind = "full",
): string {
  const parts = Object.keys(revids)
    .sort()
    .map((l) => `${l}${revids[l]}`)
    .join(".");
  const suffix = scope === "full" ? "" : `:${scope}`;
  return `${qid}:${parts}:${promptVersion}:${parserVersion}${suffix}`;
}

export interface CachedComparison {
  result: ComparisonResult;
  /** The key the row was stored under. Equal to the requested key on an exact
   *  hit; different means it was computed from revisions that have since moved. */
  cacheKey: string;
  computedAt: string;
}

/**
 * The comparison to serve for `qid`, or null if none is usable.
 *
 * One statement covers both reads. An exact key match is preferred — it
 * describes exactly the revisions being asked about — and otherwise the newest
 * row for the subject answers, however old it is. Sorting on key equality first
 * is what makes that preference hold rather than merely usually hold, since a
 * row for superseded revisions can be the more recently written of the two.
 *
 * Answering past an edit is the point rather than a concession. A Wikipedia
 * article of any prominence is edited several times a day, most of those edits
 * touching a category or a citation, and a cache that stopped answering for them
 * would re-read the whole article — three fetches, a parse and the model —
 * because somebody moved a comma. Nothing is hidden by serving the older answer:
 * the key still records exactly which revisions it describes, so `edited` says
 * which editions have moved and the badge offers the re-read. Reprocessing is
 * something a reader asks for, never something that happens to them for opening
 * a page.
 *
 * What is never reused is a row computed under a different prompt or parser
 * version, for revisions it was not keyed to: those two versions are the whole
 * way we say "our reading of this changed", and reusing across them would make
 * every prompt fix invisible on precisely the articles it was written for. The
 * versions are read out of the stored result rather than parsed back off the
 * key, which keeps the key's shape an implementation detail of `comparisonKey`.
 *
 * Scope adds a second preference, and it sits above exactness rather than below
 * it: a full comparison wins over a preview even when the preview is the exact
 * one and the full run describes superseded revisions. A preview read four
 * sections and stopped; a full run read the article. Serving the preview because
 * its revision ids match more precisely would fade out most of the page in order
 * to be pedantic about revisions that have usually only moved by a citation.
 * Nothing is hidden by the choice — an answer older than live still carries the
 * `cached` badge, whatever its scope.
 *
 * So the ranking is: the exact full run, then the newest full run, then the
 * exact preview, then the newest preview. Rows written before previews existed
 * have no `scope` at all and COALESCE reads them as full, which is what they are.
 *
 * `exactOnly` drops everything but the two keys, and exists for the check the
 * funded path makes before it charges: there the question is "does this exact
 * comparison already exist", and an answer about neighbouring revisions would
 * hand somebody a different comparison than the one they pressed the button for.
 */
export async function getCachedComparison(
  qid: string,
  fullKey: string,
  previewKey: string,
  promptVersion: string,
  parserVersion: string,
  exactOnly = false,
): Promise<CachedComparison | null> {
  const rows = await sql()`
    SELECT cache_key, result, computed_at
    FROM comparisons
    WHERE qid = ${qid}
      AND (
        cache_key IN (${fullKey}, ${previewKey})
        OR (
          NOT ${exactOnly}::boolean
          AND result->>'promptVersion' = ${promptVersion}
          AND result->>'parserVersion' IS NOT DISTINCT FROM ${parserVersion}
        )
      )
    ORDER BY
      (cache_key = ${fullKey}) DESC,
      (COALESCE(result->'scope'->>'kind', 'full') = 'full') DESC,
      (cache_key = ${previewKey}) DESC,
      computed_at DESC
    LIMIT 1
  `;
  if (!rows.length) return null;
  return {
    result: rows[0].result as ComparisonResult,
    cacheKey: rows[0].cache_key as string,
    computedAt: new Date(rows[0].computed_at as string).toISOString(),
  };
}

/**
 * How many readers a stored comparison has served.
 *
 * The number exists to be said back to whoever funded it: a donation buys other
 * people's reading, and "112 people have read what you paid for" is the only
 * honest way to describe what the money did. Incremented on the serving path, so
 * it is deliberately fire-and-forget — a failure to count a read must never
 * delay or fail the read itself, which is the same rule `/api/recent` follows
 * when it answers with an empty list rather than an error.
 */
export async function bumpServedCount(cacheKey: string): Promise<void> {
  try {
    await sql()`UPDATE comparisons SET served_count = served_count + 1 WHERE cache_key = ${cacheKey}`;
  } catch (error) {
    console.warn("served_count not incremented:", error instanceof Error ? error.message : error);
  }
}

/**
 * The most recently computed *valid* comparison for each subject, newest first.
 *
 * Every cached subject, not a page of them: the ledger on the landing page is
 * the whole record of what has been read, and a cap there would quietly retire
 * older articles from it. One row per subject is the only reduction.
 *
 * "Valid" means the same thing it means in `getCachedComparison`: computed
 * under the current prompt and parser version. A row left behind by an older
 * version is not a comparison the site would still serve, so it has no
 * business in a ledger that reads as a promise every row can be opened —
 * clicking it would silently recompute (or charge, on a funded subject)
 * rather than show what the row claimed to be. Rows written before previews
 * existed have no `scope`, but they do carry a `promptVersion`, so this filter
 * still applies to them.
 *
 * Titles, language lists, word counts and claim tallies are all projected out
 * in SQL rather than in TypeScript: `result` holds every article's full section
 * text, so selecting the column to reduce it here would pull megabytes across
 * the wire to render a list of rows a few numbers wide.
 */
export async function recentComparisons(): Promise<RecentArticle[]> {
  const rows = await sql()`
    SELECT
      qid, title, lang, langs, scope, computed_at,
      -- The same count articleWords() does in the client: whitespace-separated
      -- words per section, summed over the edition.
      (
        SELECT jsonb_object_agg(article.key, (
          SELECT COALESCE(SUM(array_length(regexp_split_to_array(btrim(section->>'text'), '\\s+'), 1)), 0)
          FROM jsonb_array_elements(article.value->'sections') section
          WHERE btrim(section->>'text') <> ''
        ))
        FROM jsonb_each(result->'articles') article
      ) AS words,
      (
        SELECT jsonb_object_agg(kind, n) FROM (
          SELECT claim->>'type' AS kind, count(*) AS n
          FROM jsonb_array_elements(result->'claims') claim
          GROUP BY 1
        ) tally
      ) AS claims
    FROM (
      SELECT DISTINCT ON (qid)
        qid,
        result,
        COALESCE(
          result->'articles'->'en'->>'title',
          result->'articles'->'he'->>'title',
          result->'articles'->'ar'->>'title'
        ) AS title,
        CASE
          WHEN jsonb_exists(result->'articles', 'en') THEN 'en'
          WHEN jsonb_exists(result->'articles', 'he') THEN 'he'
          ELSE 'ar'
        END AS lang,
        ARRAY(SELECT jsonb_object_keys(result->'articles')) AS langs,
        -- Rows written before previews existed carry no scope at all;
        -- COALESCE reads those as full, which is what they are.
        COALESCE(result->'scope'->>'kind', 'full') AS scope,
        computed_at
      FROM comparisons
      -- Same validity test as getCachedComparison's fallback match: a row
      -- computed under a since-retired prompt or parser version is not one
      -- the site would still serve, so it does not belong in the ledger.
      WHERE result->>'promptVersion' = ${PROMPT_VERSION}
        AND result->>'parserVersion' IS NOT DISTINCT FROM ${PARSER_VERSION}
      ORDER BY qid, computed_at DESC
    ) latest
    WHERE title IS NOT NULL
    ORDER BY computed_at DESC
  `;
  return rows.map((row) => ({
    qid: row.qid as string,
    title: row.title as string,
    lang: row.lang as Lang,
    // jsonb orders its own keys; restore the reading order the columns use.
    langs: LANGS.filter((l) => (row.langs as string[]).includes(l)),
    scope: row.scope as ScopeKind,
    computedAt: new Date(row.computed_at as string).toISOString(),
    words: (row.words ?? {}) as Partial<Record<Lang, number>>,
    claims: { contradiction: 0, unique: 0, framing: 0, ...((row.claims ?? {}) as object) },
  }));
}

/**
 * `fundedBy` is who paid for this row, when anybody did.
 *
 * Nothing reads it to decide access — the whole point is that a funded
 * comparison belongs to everyone the moment it exists. It is here so the credit
 * bar can tell a donor how many people have since read what they paid for, which
 * needs to know which rows were theirs. An overwriting refresh reassigns it to
 * whoever paid for the refresh, and `served_count` restarts with the answer it
 * describes: the new row is a different comparison, and carrying the old one's
 * readership onto it would credit the new donor with somebody else's readers.
 */
export async function putComparison(
  key: string,
  result: ComparisonResult,
  overwrite = false,
  fundedBy: string | null = null,
): Promise<void> {
  const payload = JSON.stringify(result);
  // A ?fresh=1 run recomputed on purpose, so it should replace what is stored
  // rather than compute a new answer and silently discard it.
  if (overwrite) {
    await sql()`
      INSERT INTO comparisons (cache_key, qid, result, funded_by)
      VALUES (${key}, ${result.qid}, ${payload}, ${fundedBy})
      ON CONFLICT (cache_key) DO UPDATE
        SET result = EXCLUDED.result,
            computed_at = now(),
            funded_by = EXCLUDED.funded_by,
            served_count = 0
    `;
    return;
  }
  await sql()`
    INSERT INTO comparisons (cache_key, qid, result, funded_by)
    VALUES (${key}, ${result.qid}, ${payload}, ${fundedBy})
    ON CONFLICT (cache_key) DO NOTHING
  `;
}

/** Small lookup cache for Wikidata QID -> readable label. Not revision-scoped. */
export async function getLabels(qids: string[]): Promise<Map<string, string>> {
  if (!qids.length) return new Map();
  // The ::text[] cast is required: without it Postgres cannot infer the
  // parameter type for ANY() and rejects the statement.
  const rows = await sql()`SELECT qid, label FROM labels WHERE qid = ANY(${qids}::text[])`;
  return new Map(rows.map((r) => [r.qid as string, r.label as string]));
}

export async function putLabels(entries: Map<string, string>): Promise<void> {
  if (!entries.size) return;
  const qids = [...entries.keys()];
  const labels = qids.map((q) => entries.get(q)!);
  await sql()`
    INSERT INTO labels (qid, label)
    SELECT * FROM UNNEST(${qids}::text[], ${labels}::text[])
    ON CONFLICT (qid) DO NOTHING
  `;
}
