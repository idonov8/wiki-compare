"use client";

import { useEffect, useState } from "react";

/** How long the pointer rests on a claim before its explanation is asked for:
 *  a mark crossed on the way somewhere else costs nothing. */
const DWELL = 450;

const finished = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

async function fetchExplanation(cacheKey: string, claimId: string, onText: (text: string) => void): Promise<string> {
  const res = await fetch("/api/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cacheKey, claimId }),
  });
  if (!res.ok || !res.body) throw new Error(`explain ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onText(text);
  }
  if (!text.trim()) throw new Error("empty explanation");
  return text;
}

/**
 * A claim's generated explanation, streamed in as it is written. Finished
 * explanations are kept for the rest of the visit, and two asks for the same
 * claim share one request.
 */
export function useExplanation(cacheKey: string | undefined, claimId: string | undefined) {
  const id = cacheKey && claimId ? `${cacheKey}|${claimId}` : null;
  const [state, setState] = useState<{ id: string | null; text: string; failed: boolean }>({
    id: null,
    text: "",
    failed: false,
  });

  useEffect(() => {
    if (!id || !cacheKey || !claimId) return;
    const done = finished.get(id);
    if (done) {
      setState({ id, text: done, failed: false });
      return;
    }
    let live = true;
    setState({ id, text: "", failed: false });
    const timer = setTimeout(() => {
      let request = pending.get(id);
      if (!request) {
        request = fetchExplanation(cacheKey, claimId, (text) => live && setState({ id, text, failed: false }));
        pending.set(id, request);
      }
      request
        .then((text) => {
          finished.set(id, text);
          if (live) setState({ id, text, failed: false });
        })
        .catch(() => live && setState({ id, text: "", failed: true }))
        .finally(() => pending.delete(id));
    }, DWELL);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [id, cacheKey, claimId]);

  return state.id === id ? state : { id, text: "", failed: false };
}
