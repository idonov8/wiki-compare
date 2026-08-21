import { readNdjson } from "./ndjson";
import type {
  ArticleSnapshot,
  Claim,
  CompareEvent,
  ComparePayload,
  ComparisonScope,
} from "./types";

export interface CompareSink {
  /** Called for every event before it is dispatched; `false` drops it. This is
   *  how a read that has been superseded — the reader followed a link, pressed
   *  back — stops writing to a page that has moved on without it. */
  accept?: (event: CompareEvent) => boolean;
  articles: (articles: Record<string, ArticleSnapshot>) => void;
  scope: (scope: ComparisonScope) => void;
  claim: (claim: Claim) => void;
}

/**
 * Read one streaming `/api/compare` response, reporting progress to `sink` as
 * it arrives and resolving with the finished payload.
 *
 * A comparison fails in two places — a JSON body before the first line, or an
 * `error` event partway through — and both are thrown, so every caller has one
 * place to handle a failure rather than two.
 */
export async function streamComparison(
  res: Response,
  sink: CompareSink,
  whenBroken = "Comparison failed.",
): Promise<ComparePayload> {
  if (!res.ok || !res.body) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? whenBroken);
  }

  let final: ComparePayload | null = null;
  let failed: string | null = null;

  await readNdjson<CompareEvent>(res.body, (event) => {
    if (sink.accept && !sink.accept(event)) return;
    switch (event.event) {
      case "articles":
        sink.articles(event.articles);
        break;
      case "scope":
        sink.scope(event.scope);
        break;
      case "claim":
        sink.claim(event.claim);
        break;
      case "done":
        final = { ...event.result, fromCache: event.fromCache, cache: event.cache };
        break;
      case "error":
        failed = event.error;
        break;
    }
  });

  if (failed) throw new Error(failed);
  if (!final) throw new Error("The comparison ended without returning a result.");
  return final as ComparePayload;
}
