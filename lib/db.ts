import { neon } from "@neondatabase/serverless";
import {
  CACHE_WINDOW_DAYS,
  LANGS,
  type ArticleSnapshot,
  type ComparisonResult,
  type Lang,
  type RecentArticle,
  type ScopeKind,
} from "./types";

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
 * Rows are still never overwritten by that rule alone, but reads are looser than
 * writes: see CACHE_WINDOW_DAYS in lib/types.ts.
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
 * One statement covers both reads. An exact key match is preferred whatever its
 * age — it describes exactly the revisions being asked about, so it is never
 * stale — and otherwise the newest row inside the window answers. Sorting on key
 * equality first is what makes that preference hold rather than merely usually
 * hold, since a row for superseded revisions can be the more recently written of
 * the two.
 *
 * The window forgives one thing only: revision ids that have moved on. A row
 * computed under a different prompt or parser version is never reused for
 * revisions it was not keyed to, because those two versions are the whole way we
 * say "our reading of this changed" — letting them ride the window would make
 * every prompt fix invisible for three days on precisely the busy articles it
 * was written for. The versions are read out of the stored result rather than
 * parsed back off the key, which keeps the key's shape an implementation detail
 * of `comparisonKey`.
 *
 * Scope adds a second preference, and it sits above exactness rather than below
 * it: a full comparison wins over a preview even when the preview is the exact
 * one and the full run is riding the window. A preview read four sections and
 * stopped; a full run read the article. Serving the preview because its revision
 * ids match more precisely would fade out most of the page in order to be
 * pedantic about revisions that, by the window's own argument, have usually only
 * moved by a citation. Nothing is hidden by the choice — an answer older than
 * live still carries the `cached` badge, whatever its scope.
 *
 * So the ranking is: the exact full run, then the newest full run, then the
 * exact preview, then the newest preview. Rows written before previews existed
 * have no `scope` at all and COALESCE reads them as full, which is what they are.
 */
export async function getCachedComparison(
  qid: string,
  fullKey: string,
  previewKey: string,
  promptVersion: string,
  parserVersion: string,
  windowDays: number = CACHE_WINDOW_DAYS,
): Promise<CachedComparison | null> {
  const rows = await sql()`
    SELECT cache_key, result, computed_at
    FROM comparisons
    WHERE qid = ${qid}
      AND (
        cache_key IN (${fullKey}, ${previewKey})
        OR (
          computed_at > now() - make_interval(days => ${windowDays}::int)
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
 * The most recently computed comparison for each subject, newest first.
 *
 * Every cached subject, not a page of them: the ledger on the landing page is
 * the whole record of what has been read, and a cap there would quietly retire
 * older articles from it. One row per subject is the only reduction.
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
