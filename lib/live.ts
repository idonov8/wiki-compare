import type { CompareEvent, ComparisonResult } from "./types";

/**
 * The runs happening right now, so a second reader joins one instead of paying
 * for a second.
 *
 * The case this exists for is a reload: the reader reopens the tab a minute
 * into a comparison, the client asks for the same article again, and without
 * this the server starts the whole read over — the model runs twice, and the
 * differences already found are thrown away. Joining replays what the run has
 * emitted so far and then follows it live, so the reload picks up mid-stream
 * rather than from nothing. Two tabs on the same article get the same deal.
 *
 * ponytail: a per-process Map, not a shared one. On more than one instance a
 * reload can land elsewhere and start its own run — the old behaviour, no
 * worse. Making it cross-instance means the events going through Postgres or
 * Redis, which is a lot of machinery for the tail of a case that is already
 * charged for once. The upgrade path is to swap this Map for that.
 */
interface LiveRun {
  /** Everything emitted so far, replayed to whoever joins late. */
  events: CompareEvent[];
  subscribers: Set<(event: CompareEvent) => void>;
  result: Promise<ComparisonResult>;
}

const globalRuns = globalThis as { __wikiCompareRuns?: Map<string, LiveRun> };
// Survives the module reload the dev server does on every edit.
const runs = (globalRuns.__wikiCompareRuns ??= new Map<string, LiveRun>());

export function liveRun(...keys: string[]): LiveRun | undefined {
  for (const key of keys) {
    const run = runs.get(key);
    if (run) return run;
  }
  return undefined;
}

/**
 * Run `start` under `key`, broadcasting its events to `emit` and to anyone who
 * joins before it finishes.
 */
export function trackRun(
  key: string,
  emit: (event: CompareEvent) => void,
  start: (emit: (event: CompareEvent) => void) => Promise<ComparisonResult>,
): Promise<ComparisonResult> {
  const run: LiveRun = {
    events: [],
    subscribers: new Set([emit]),
    result: undefined as unknown as Promise<ComparisonResult>,
  };
  const broadcast = (event: CompareEvent) => {
    run.events.push(event);
    for (const subscriber of run.subscribers) subscriber(event);
  };
  // A failed run must not be joinable, and neither must a finished one: its
  // result is in the comparison cache by then, which is the cheaper answer.
  run.result = start(broadcast).finally(() => {
    if (runs.get(key) === run) runs.delete(key);
  });
  runs.set(key, run);
  return run.result;
}

/** Catch `emit` up on a run in progress, then stay with it to the end. */
export async function followRun(
  run: LiveRun,
  emit: (event: CompareEvent) => void,
): Promise<ComparisonResult> {
  for (const event of run.events) emit(event);
  run.subscribers.add(emit);
  try {
    return await run.result;
  } finally {
    run.subscribers.delete(emit);
  }
}
