import { NextResponse } from "next/server";
import {
  type CacheInfo,
  type Claim,
  type CompareEvent,
  type ComparisonResult,
  type Lang,
} from "@/lib/types";
import { PARSER_VERSION, fetchLabels } from "@/lib/wikipedia";
import { followRun, liveRun, trackRun } from "@/lib/live";
import { resolveTarget, snapshotsFor } from "@/lib/articles";
import {
  bumpServedCount,
  comparisonKey,
  getCachedComparison,
  getLabels,
  putComparison,
  putLabels,
} from "@/lib/db";
import { coverageGaps } from "@/lib/deterministic";
import { JEV_VERSION, runJevComparison } from "@/lib/jev/pipeline";
import { allow, visitorKey } from "@/lib/rate-limit";
import { capture } from "@/lib/analytics";

export const runtime = "nodejs";
export const maxDuration = 120;

interface Target {
  qid: string;
  titles: Partial<Record<Lang, string>>;
  revids: Record<string, number>;
  langs: Lang[];
}

class TooManyComparisons extends Error {
  constructor() {
    super("Too many new comparisons from here; try again in a few minutes.");
  }
}

/** Read the article, price it, store it. */
async function computeAndStore(
  target: Target,
  {
    overwrite = false,
    emit = () => {},
  }: {
    overwrite?: boolean;
    /** Called as each stage becomes available, for the streaming path. The
     *  articles land in about a second and the coverage diff costs no tokens, so
     *  both are worth sending long before the model has finished. */
    emit?: (event: CompareEvent) => void;
  } = {},
): Promise<{ result: ComparisonResult; cacheKey: string }> {
  const { qid, titles, revids, langs } = target;
  const cacheKey = comparisonKey(qid, revids, JEV_VERSION, PARSER_VERSION);

  // Registered before any work starts, so a tab reopened mid-run joins this one
  // rather than starting a second read of the same article.
  const result = await trackRun(cacheKey, emit, async (send) => {
    const articles = await snapshotsFor(langs, titles, revids);
    send({
      event: "articles",
      qid,
      articles: Object.fromEntries(articles.map((a) => [a.lang, a])),
    });

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
    send({ event: "coverage", coverage });

    const started = Date.now();
    const onClaim = (claim: Claim) => send({ event: "claim", claim });
    const run = await runJevComparison(articles, onClaim);
    void capture("jev_comparison_run", {
      qid,
      claims: run.claims.length,
      contradiction: run.claims.filter((c) => c.type === "contradiction").length,
      unique: run.claims.filter((c) => c.type === "unique").length,
      framing: run.claims.filter((c) => c.type === "framing").length,
      requests: run.requests,
      inputTokens: run.usage.inputTokens,
      costUsd: run.usage.costUsd ?? 0,
      ms: Date.now() - started,
    });

    const result: ComparisonResult = {
      qid,
      articles: Object.fromEntries(articles.map((a) => [a.lang, a])),
      claims: run.claims,
      coverage,
      promptVersion: JEV_VERSION,
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
    // Stored while the run is still joinable, so the moment it stops being one
    // there is a cached row to serve instead.
    await putComparison(cacheKey, result, overwrite);
    return result;
  });

  return { result, cacheKey };
}

/** Which languages the reader is seeing at an older revision than the live one. */
function editedSince(result: ComparisonResult, target: Target): Lang[] {
  return target.langs.filter((l) => result.articles[l]?.revid !== target.revids[l]);
}

function cacheInfo(result: ComparisonResult, computedAt: string, target: Target): CacheInfo {
  return { computedAt, edited: editedSince(result, target) };
}

/**
 * One JSON object per line, flushed as the comparison produces it.
 *
 * NDJSON rather than server-sent events: there is nothing to reconnect to and no
 * event-name routing to do, so `text/event-stream`'s framing would be ceremony
 * around a `\n`. The reader is `fetch` plus a line split, which is a dozen lines
 * on the client and needs no EventSource.
 *
 * The last line is always `done` or `error`, and `done` carries the whole
 * `ComparisonResult` — the same object the non-streaming path returns. Everything
 * before it is an optimisation the client may render early, so a reader that only
 * waits for the last line is correct, just slower. That is what keeps the two
 * paths from drifting: the stream is the JSON response with progress in front of
 * it, not a second contract.
 */
function ndjson(run: (emit: (event: CompareEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: CompareEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // The reader has gone. Stop writing, but let the run finish and store.
          closed = true;
        }
      };
      try {
        await run(emit);
      } catch (error) {
        emit({
          event: "error",
          error: error instanceof Error ? error.message : "Comparison failed.",
        });
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      // Nginx and friends buffer a proxied response by default, which would hold
      // every line back until the last one and undo the entire point.
      "X-Accel-Buffering": "no",
    },
  });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const title = params.get("title")?.trim();
  const sourceLang = params.get("lang")?.trim() || "en";

  if (!title) {
    return NextResponse.json({ error: "Add a ?title= parameter." }, { status: 400 });
  }

  const streaming = params.get("stream") === "1";

  // Render a recorded fixture instead of calling anything. Development only —
  // it exists so the rendering layer can be worked on without a database, an
  // API key, or spending tokens, and it is dead code in production.
  if (process.env.NODE_ENV !== "production" && title.startsWith("demo:")) {
    let result: ComparisonResult;
    try {
      const { demoComparison } = await import("@/fixtures/demo");
      result = demoComparison(title.slice(5));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A fixture that does not exist is a 404 in both shapes: nothing has been
      // written to the stream yet, so the status code can still say so.
      return NextResponse.json({ error: `No such fixture. ${message}` }, { status: 404 });
    }
    // A fixture is a finished comparison, so the stream is one `done` line. It
    // still has to be a stream: the client asked for one, and a fixture that
    // answered in a different shape would exercise a path nothing else uses.
    return streaming
      ? ndjson(async (emit) => emit({ event: "done", result, fromCache: false }))
      : NextResponse.json({ ...result, fromCache: false });
  }

  // ?fresh=1 recomputes and overwrites rather than reading the comparison
  // cache. An explicit, narrow bypass for iterating on the prompt — it leaves
  // the caching logic and the article cache intact, so debugging never means
  // deleting rows or commenting out the check and forgetting to restore it.
  // It stays a development affordance.
  const bypassCache = params.get("fresh") === "1" && process.env.NODE_ENV !== "production";

  /**
   * The read itself, reporting progress to `emit` if anyone is listening.
   *
   * Shared by both response shapes so there is one description of what a read
   * does. `emit` is a no-op for the plain JSON caller, which reduces this to
   * precisely the sequence it ran before.
   */
  const serve = async (emit: (event: CompareEvent) => void) => {
    const target = await resolveTarget(title, sourceLang);
    const { qid, revids } = target;
    const key = comparisonKey(qid, revids, JEV_VERSION, PARSER_VERSION);

    const cached = bypassCache ? null : await getCachedComparison(qid, key, JEV_VERSION, PARSER_VERSION);

    // Somebody is already reading this article — a reload of this same tab, most
    // likely. Join that run: its progress replays at once and the rest arrives
    // as it is found, which is the reload picking the stream back up rather than
    // paying for a second read of the same article.
    const live = liveRun(key);
    if (live) {
      const joined = await followRun(live, emit);
      emit({ event: "done", result: joined, fromCache: false });
      return { ...joined, fromCache: false };
    }

    if (cached) {
      // Counting the read must not be able to delay or fail serving it.
      void bumpServedCount(cached.cacheKey);
      void capture("comparison_served", { qid, fromCache: true, costUsd: 0 });
      const cache = cacheInfo(cached.result, cached.computedAt, target);
      emit({ event: "done", result: cached.result, fromCache: true, cache });
      return { ...cached.result, fromCache: true, cache };
    }

    // Only a read that would spend anything is limited: a cached answer and a
    // joined run cost nothing more.
    if (!allow(`compare:${visitorKey(request.headers)}`, 10, 10 * 60_000)) {
      throw new TooManyComparisons();
    }

    const { result } = await computeAndStore(target, { overwrite: bypassCache, emit });
    void capture("comparison_served", { qid, fromCache: false, costUsd: result.usage.costUsd ?? 0 });
    emit({ event: "done", result, fromCache: false });
    return { ...result, fromCache: false };
  };

  if (streaming) {
    // Errors travel as a final `error` line on a 200, because the status line is
    // long gone by the time the model fails — the articles were sent a minute
    // earlier. The client reads the last line either way.
    return ndjson(async (emit) => {
      await serve(emit);
    });
  }

  try {
    return NextResponse.json(await serve(() => {}));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Comparison failed.";
    return NextResponse.json({ error: message }, { status: error instanceof TooManyComparisons ? 429 : 500 });
  }
}
