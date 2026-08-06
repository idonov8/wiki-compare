import { NextResponse } from "next/server";
import { CACHE_WINDOW_DAYS, type ComparisonResult } from "@/lib/types";
import { PARSER_VERSION, fetchLabels } from "@/lib/wikipedia";
import { resolveTarget, snapshotsFor } from "@/lib/articles";
import {
  comparisonKey,
  getCachedComparison,
  getLabels,
  putComparison,
  putLabels,
} from "@/lib/db";
import { coverageGaps } from "@/lib/deterministic";
import { PROMPT_VERSION, runComparison } from "@/lib/compare";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const title = params.get("title")?.trim();
  const sourceLang = params.get("lang")?.trim() || "en";

  if (!title) {
    return NextResponse.json({ error: "Add a ?title= parameter." }, { status: 400 });
  }

  // Render a recorded fixture instead of calling anything. Development only —
  // it exists so the rendering layer can be worked on without a database, an
  // API key, or spending tokens, and it is dead code in production.
  if (process.env.NODE_ENV !== "production" && title.startsWith("demo:")) {
    try {
      const { demoComparison } = await import("@/fixtures/demo");
      return NextResponse.json({ ...demoComparison(title.slice(5)), fromCache: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return NextResponse.json({ error: `No such fixture. ${message}` }, { status: 404 });
    }
  }

  try {
    const { qid, titles, revids, langs } = await resolveTarget(title, sourceLang);
    const key = comparisonKey(qid, revids, PROMPT_VERSION, PARSER_VERSION);

    // ?fresh=1 recomputes and overwrites rather than reading the comparison
    // cache. An explicit, narrow bypass for iterating on the prompt — it leaves
    // the caching logic and the article cache intact, so debugging never means
    // deleting rows or commenting out the check and forgetting to restore it.
    const bypassCache = params.get("fresh") === "1";

    const cached = bypassCache
      ? null
      : await getCachedComparison(qid, key, PROMPT_VERSION, PARSER_VERSION);
    if (cached) {
      // Which languages the reader is seeing at an older revision than the live
      // one. Computed against the served snapshot rather than the cache key, so
      // a key that differs only by prompt version reports no edits — and a
      // language that has appeared since is counted, its cached revid being
      // absent rather than merely different.
      const edited = langs.filter((l) => cached.result.articles[l]?.revid !== revids[l]);
      const expiresAt = new Date(
        new Date(cached.computedAt).getTime() + CACHE_WINDOW_DAYS * 86_400_000,
      ).toISOString();
      return NextResponse.json({
        ...cached.result,
        fromCache: true,
        cache: { computedAt: cached.computedAt, expiresAt, edited },
      });
    }

    const articles = await snapshotsFor(langs, titles, revids);

    // Coverage diff: no tokens involved, only set arithmetic over Wikidata ids.
    const allQids = [...new Set(articles.flatMap((a) => a.linkQids))];
    const known = await getLabels(allQids);
    const missing = allQids.filter((q) => !known.has(q));
    if (missing.length) {
      const fetched = await fetchLabels(missing);
      await putLabels(fetched);
      for (const [qid_, label] of fetched) known.set(qid_, label);
    }
    const coverage = coverageGaps(articles, known);

    const { claims, usage, spans } = await runComparison(articles);

    const result: ComparisonResult = {
      qid,
      articles: Object.fromEntries(articles.map((a) => [a.lang, a])),
      claims,
      coverage,
      promptVersion: PROMPT_VERSION,
      parserVersion: PARSER_VERSION,
      computedAt: new Date().toISOString(),
      usage,
      spans: { offered: spans.offered, matched: spans.matched, droppedClaims: spans.droppedClaims },
    };

    await putComparison(key, result, bypassCache);
    return NextResponse.json({ ...result, fromCache: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Comparison failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
