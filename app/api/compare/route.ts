import { NextResponse } from "next/server";
import { LANGS, type ArticleSnapshot, type ComparisonResult, type Lang } from "@/lib/types";
import { PARSER_VERSION, currentRevid, fetchArticle, fetchLabels, resolveSitelinks } from "@/lib/wikipedia";
import { comparisonKey, getArticle, getComparison, getLabels, putArticle, putComparison, putLabels } from "@/lib/db";
import { coverageGaps } from "@/lib/deterministic";
import { PROMPT_VERSION, runComparison } from "@/lib/compare";

export const runtime = "nodejs";
export const maxDuration = 120;

function isLang(value: string | null): value is Lang {
  return LANGS.includes(value as Lang);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const title = params.get("title")?.trim();
  const sourceLang = params.get("lang");

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
    const { qid, titles } = await resolveSitelinks(title, isLang(sourceLang) ? sourceLang : "en");
    const available = LANGS.filter((l) => titles[l]);

    if (available.length < 2) {
      return NextResponse.json(
        {
          error: `${qid} only exists in ${available.join(", ") || "none"} of the three languages, so there is nothing to compare.`,
        },
        { status: 404 },
      );
    }

    // Resolve current revisions first. This is three tiny calls and lets both
    // caches answer without touching the parser or the model.
    const revids: Record<string, number> = {};
    await Promise.all(
      available.map(async (lang) => {
        const revid = await currentRevid(lang, titles[lang]!);
        if (revid) revids[lang] = revid;
      }),
    );

    const langs = available.filter((l) => revids[l]);
    const key = comparisonKey(qid, revids, PROMPT_VERSION, PARSER_VERSION);

    // ?fresh=1 recomputes and overwrites rather than reading the comparison
    // cache. An explicit, narrow bypass for iterating on the prompt — it leaves
    // the caching logic and the article cache intact, so debugging never means
    // deleting rows or commenting out the check and forgetting to restore it.
    const bypassCache = params.get("fresh") === "1";

    const cached = bypassCache ? null : await getComparison(key);
    if (cached) {
      return NextResponse.json({ ...cached, fromCache: true });
    }

    const articles: ArticleSnapshot[] = await Promise.all(
      langs.map(async (lang) => {
        const hit = await getArticle(lang, revids[lang], PARSER_VERSION);
        if (hit) return hit;
        const fresh = await fetchArticle(lang, titles[lang]!);
        await putArticle(fresh, PARSER_VERSION);
        return fresh;
      }),
    );

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
