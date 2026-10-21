import { NextResponse } from "next/server";
import { getComparisonByKey, getExplanation, putExplanation } from "@/lib/db";
import { streamExplanation } from "@/lib/explain";
import { allow, visitorKey } from "@/lib/rate-limit";
import { capture } from "@/lib/analytics";
import { costOfUsage } from "@/lib/pricing";
import type { Usage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * A generated explanation of one claim, written on the first hover and stored.
 *
 * Plain text, streamed: the reader is looking at the card while it is written,
 * so the first words should appear as soon as the model has them. A stored
 * explanation is the same response in one piece. A stream that ends empty is a
 * failure; by then the status line has gone, so the client checks for text.
 *
 * Asked for by the comparison's key and the claim's id rather than by the text
 * itself, so the prompt is always built from what the comparison stored and the
 * route cannot be used to send arbitrary text to the model.
 */
export async function POST(request: Request) {
  let body: { cacheKey?: unknown; claimId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  const { cacheKey, claimId } = body;
  if (typeof cacheKey !== "string" || typeof claimId !== "string") {
    return NextResponse.json({ error: "Expected cacheKey and claimId." }, { status: 400 });
  }

  const text = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store, no-transform" };

  const stored = await getExplanation(cacheKey, claimId);
  if (stored) {
    void capture("explanation_served", { cacheKey, claimId, cached: true });
    return new Response(stored, { headers: text });
  }

  if (!allow(`explain:${visitorKey(request.headers)}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many explanations at once; try again in a minute." }, { status: 429 });
  }

  const result = await getComparisonByKey(cacheKey);
  const claim = result?.claims.find((c) => c.id === claimId);
  if (!result || !claim) {
    return NextResponse.json({ error: "No such difference." }, { status: 404 });
  }

  const started = Date.now();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const write = (piece: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(piece));
        } catch {
          // The reader moved on. Finish anyway, so the explanation is stored.
          open = false;
        }
      };
      try {
        const done = await streamExplanation(result, claim, write);
        const raw = done.usage as { input_tokens?: number; output_tokens?: number };
        const usage: Usage = {
          inputTokens: raw.input_tokens ?? 0,
          outputTokens: raw.output_tokens ?? 0,
          cachedInputTokens: 0,
          byModel: { [done.model]: { inputTokens: raw.input_tokens ?? 0, outputTokens: raw.output_tokens ?? 0, cachedInputTokens: 0 } },
        };
        await putExplanation(cacheKey, claimId, done.text, done.model, done.usage);
        void capture("explanation_served", {
          cacheKey,
          claimId,
          cached: false,
          type: claim.type,
          model: done.model,
          costUsd: costOfUsage(usage, done.model),
          ms: Date.now() - started,
        });
      } catch (error) {
        console.error("[explain]", error instanceof Error ? error.message : error);
      } finally {
        if (open) controller.close();
      }
    },
  });

  return new Response(stream, { headers: { ...text, "X-Accel-Buffering": "no" } });
}
