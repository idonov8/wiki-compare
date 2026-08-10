import { NextResponse } from "next/server";
import {
  CACHE_WINDOW_DAYS,
  type ComparisonResult,
  type Lang,
  type ScopeKind,
} from "@/lib/types";
import { PARSER_VERSION, fetchLabels } from "@/lib/wikipedia";
import { resolveTarget, snapshotsFor } from "@/lib/articles";
import {
  bumpServedCount,
  comparisonKey,
  getCachedComparison,
  getLabels,
  putComparison,
  putLabels,
} from "@/lib/db";
import { coverageDiff } from "@/lib/deterministic";
import { PROMPT_VERSION, runComparison } from "@/lib/compare";
import { getSessionUser } from "@/lib/auth";
import { debit, grant, recordSpend } from "@/lib/credits";
import { PRICE_PER_ARTICLE_CENTS } from "@/lib/pricing";
import { capture } from "@/lib/analytics";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Two verbs, one comparison.
 *
 * GET is the free path and is the one every reader lands on. It serves whatever
 * is cached, and when nothing is, it reads the first few sections and stops —
 * a preview, which costs a fraction of a full run and is what the fade-out in
 * the columns is describing. It never charges anybody and never needs an account.
 *
 * POST is the funded path: it debits a credit and reads the whole article, or
 * re-reads one whose revisions have moved on. Splitting them this way keeps the
 * anonymous path exactly as it was, and means the paid one cannot be reached by
 * guessing at a query string.
 *
 * What both share: whatever anyone pays for is stored, and the next reader gets
 * it for nothing. That is the entire model and it is why the free path is
 * allowed to be generous.
 */

interface Target {
  qid: string;
  titles: Partial<Record<Lang, string>>;
  revids: Record<string, number>;
  langs: Lang[];
}

/** Read the article, price it, store it. Shared by both verbs. */
async function computeAndStore(
  target: Target,
  scope: ScopeKind,
  { overwrite = false, fundedBy = null }: { overwrite?: boolean; fundedBy?: string | null } = {},
): Promise<{ result: ComparisonResult; cacheKey: string }> {
  const { qid, titles, revids, langs } = target;
  const articles = await snapshotsFor(langs, titles, revids);

  // Coverage diff: no tokens involved, only set arithmetic over Wikidata ids.
  // It runs on a preview too — it is free, and it describes the whole article
  // rather than the part that was read, so withholding it would buy nothing.
  const allQids = [...new Set(articles.flatMap((a) => a.linkQids))];
  const known = await getLabels(allQids);
  const missing = allQids.filter((q) => !known.has(q));
  if (missing.length) {
    const fetched = await fetchLabels(missing);
    await putLabels(fetched);
    for (const [qid_, label] of fetched) known.set(qid_, label);
  }
  const coverage = coverageDiff(articles, known);

  const run = await runComparison(articles, scope);

  const result: ComparisonResult = {
    qid,
    articles: Object.fromEntries(articles.map((a) => [a.lang, a])),
    claims: run.claims,
    coverage: coverage.gaps,
    coverageOnly: coverage.only,
    promptVersion: PROMPT_VERSION,
    parserVersion: PARSER_VERSION,
    computedAt: new Date().toISOString(),
    usage: run.usage,
    scope: run.scope,
    spans: {
      offered: run.spans.offered,
      matched: run.spans.matched,
      droppedClaims: run.spans.droppedClaims,
    },
  };

  const cacheKey = comparisonKey(qid, revids, PROMPT_VERSION, PARSER_VERSION, scope);
  await putComparison(cacheKey, result, overwrite, fundedBy);
  return { result, cacheKey };
}

/** Which languages the reader is seeing at an older revision than the live one. */
function editedSince(result: ComparisonResult, target: Target): Lang[] {
  return target.langs.filter((l) => result.articles[l]?.revid !== target.revids[l]);
}

function cacheInfo(result: ComparisonResult, computedAt: string, target: Target) {
  return {
    computedAt,
    expiresAt: new Date(
      new Date(computedAt).getTime() + CACHE_WINDOW_DAYS * 86_400_000,
    ).toISOString(),
    edited: editedSince(result, target),
  };
}

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
    const target = await resolveTarget(title, sourceLang);
    const { qid, revids } = target;
    const fullKey = comparisonKey(qid, revids, PROMPT_VERSION, PARSER_VERSION, "full");
    const previewKey = comparisonKey(qid, revids, PROMPT_VERSION, PARSER_VERSION, "preview");

    // ?fresh=1 recomputes and overwrites rather than reading the comparison
    // cache. An explicit, narrow bypass for iterating on the prompt — it leaves
    // the caching logic and the article cache intact, so debugging never means
    // deleting rows or commenting out the check and forgetting to restore it.
    // It stays a development affordance: in production a re-read is bought
    // through POST, not asked for in a query string.
    const bypassCache = params.get("fresh") === "1" && process.env.NODE_ENV !== "production";

    const cached = bypassCache
      ? null
      : await getCachedComparison(qid, fullKey, previewKey, PROMPT_VERSION, PARSER_VERSION);

    if (cached) {
      // Counting the read must not be able to delay or fail serving it.
      void bumpServedCount(cached.cacheKey);
      void capture("comparison_served", {
        qid,
        fromCache: true,
        scope: cached.result.scope?.kind ?? "full",
        costUsd: 0,
      });
      return NextResponse.json({
        ...cached.result,
        fromCache: true,
        cache: cacheInfo(cached.result, cached.computedAt, target),
      });
    }

    // Nothing stored: read the top of the article and stop. The columns fade out
    // below what this covered, and funding it through POST reads the rest.
    const { result } = await computeAndStore(target, bypassCache ? "full" : "preview", {
      overwrite: bypassCache,
    });
    void capture("comparison_served", {
      qid,
      fromCache: false,
      scope: result.scope?.kind ?? "full",
      costUsd: result.usage.costUsd ?? 0,
    });
    return NextResponse.json({ ...result, fromCache: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Comparison failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Buy the rest of the article, or a re-read of one that has moved on.
 *
 * The debit happens before the model runs and is refunded if it throws: nobody
 * pays for a comparison they did not get. The refund is deliberately not wrapped
 * in a transaction with the run — the model call takes about a minute, and
 * holding a row lock across it would serialise every donor in the system behind
 * whoever is currently reading the longest article.
 */
export async function POST(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) {
    return NextResponse.json({ error: "Sign in to process an article." }, { status: 401 });
  }

  let body: { title?: string; lang?: string; kind?: "full" | "refresh" };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const title = body.title?.trim();
  const sourceLang = body.lang?.trim() || "en";
  const kind = body.kind === "refresh" ? "refresh" : "full";
  if (!title) {
    return NextResponse.json({ error: "Add a title." }, { status: 400 });
  }

  let charged = false;
  try {
    const target = await resolveTarget(title, sourceLang);
    const { qid, revids } = target;
    const fullKey = comparisonKey(qid, revids, PROMPT_VERSION, PARSER_VERSION, "full");

    // Somebody else may have funded this article between the reader seeing the
    // gate and pressing the button. Charging them for a comparison that already
    // exists would be taking money for nothing, so check first and hand it over.
    if (kind === "full") {
      const existing = await getCachedComparison(
        qid,
        fullKey,
        fullKey,
        PROMPT_VERSION,
        PARSER_VERSION,
        0,
      );
      if (existing && existing.result.scope?.kind !== "preview") {
        void bumpServedCount(existing.cacheKey);
        return NextResponse.json({
          ...existing.result,
          fromCache: true,
          charged: false,
          cache: cacheInfo(existing.result, existing.computedAt, target),
        });
      }
    }

    const remaining = await debit(user.id, PRICE_PER_ARTICLE_CENTS);
    if (remaining === null) {
      return NextResponse.json(
        { error: "Not enough credit for this article.", creditCents: user.creditCents },
        { status: 402 },
      );
    }
    charged = true;

    const { result, cacheKey } = await computeAndStore(target, "full", {
      overwrite: kind === "refresh",
      fundedBy: user.id,
    });

    await recordSpend({
      userId: user.id,
      qid,
      cacheKey,
      kind,
      chargedCents: PRICE_PER_ARTICLE_CENTS,
      actualCostCents: Math.round((result.usage.costUsd ?? 0) * 100),
    });
    void capture(
      "credits_spent",
      { qid, kind, chargedCents: PRICE_PER_ARTICLE_CENTS, costUsd: result.usage.costUsd ?? 0 },
      user.id,
    );

    return NextResponse.json({
      ...result,
      fromCache: false,
      charged: true,
      creditCents: remaining,
    });
  } catch (error) {
    if (charged) await grant(user.id, PRICE_PER_ARTICLE_CENTS);
    const message = error instanceof Error ? error.message : "Comparison failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
