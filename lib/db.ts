import { neon } from "@neondatabase/serverless";
import type { ArticleSnapshot, ComparisonResult, Lang } from "./types";

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Add it in the Vercel project settings.");
  return neon(url);
}

/**
 * Two caches, both write-once.
 *
 * Wikipedia revision ids are immutable, so neither cache ever needs a TTL or an
 * invalidation pass. Keying article text on revid alone means an edit to the
 * Hebrew page does not invalidate the English or Arabic fetch. Keying the
 * comparison on all three revids plus the prompt version means the model runs
 * again only when an article actually changed or the prompt did.
 */

export async function getArticle(lang: Lang, revid: number): Promise<ArticleSnapshot | null> {
  const rows = await sql()`
    SELECT snapshot FROM articles WHERE lang = ${lang} AND revid = ${revid} LIMIT 1
  `;
  return rows.length ? (rows[0].snapshot as ArticleSnapshot) : null;
}

export async function putArticle(snapshot: ArticleSnapshot): Promise<void> {
  await sql()`
    INSERT INTO articles (lang, revid, title, snapshot)
    VALUES (${snapshot.lang}, ${snapshot.revid}, ${snapshot.title}, ${JSON.stringify(snapshot)})
    ON CONFLICT (lang, revid) DO NOTHING
  `;
}

export function comparisonKey(
  qid: string,
  revids: Record<string, number>,
  promptVersion: string,
): string {
  const parts = Object.keys(revids)
    .sort()
    .map((l) => `${l}${revids[l]}`)
    .join(".");
  return `${qid}:${parts}:${promptVersion}`;
}

export async function getComparison(key: string): Promise<ComparisonResult | null> {
  const rows = await sql()`
    SELECT result FROM comparisons WHERE cache_key = ${key} LIMIT 1
  `;
  return rows.length ? (rows[0].result as ComparisonResult) : null;
}

export async function putComparison(key: string, result: ComparisonResult): Promise<void> {
  await sql()`
    INSERT INTO comparisons (cache_key, qid, result)
    VALUES (${key}, ${result.qid}, ${JSON.stringify(result)})
    ON CONFLICT (cache_key) DO NOTHING
  `;
}

/** Small lookup cache for Wikidata QID -> readable label. Not revision-scoped. */
export async function getLabels(qids: string[]): Promise<Map<string, string>> {
  if (!qids.length) return new Map();
  const rows = await sql()`SELECT qid, label FROM labels WHERE qid = ANY(${qids})`;
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
