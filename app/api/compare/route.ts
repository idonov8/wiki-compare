import { NextResponse } from "next/server";
import { LANGS, type ArticleSnapshot, type ComparisonResult, type Lang } from "@/lib/types";
import { currentRevid, fetchArticle, fetchLabels, resolveSitelinks } from "@/lib/wikipedia";
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
    const key = comparisonKey(qid, revids, PROMPT_VERSION);

    const cached = await getComparison(key);
    if (cached) {
      return NextResponse.json({ ...cached, fromCache: true });
    }

    const articles: ArticleSnapshot[] = await Promise.all(
      langs.map(async (lang) => {
        const hit = await getArticle(lang, revids[lang]);
        if (hit) return hit;
        const fresh = await fetchArticle(lang, titles[lang]!);
        await putArticle(fresh);
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

    const { claims, usage } = await runComparison(articles);

    const result: ComparisonResult = {
      qid,
      articles: Object.fromEntries(articles.map((a) => [a.lang, a])),
      claims,
      coverage,
      promptVersion: PROMPT_VERSION,
      computedAt: new Date().toISOString(),
      usage,
    };

    await putComparison(key, result);
    return NextResponse.json({ ...result, fromCache: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Comparison failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
