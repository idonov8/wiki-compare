/**
 * Assertions over the in-flight run registry: that a reader joining a run in
 * progress is caught up on what it has already emitted, follows it to the end,
 * and cannot join one that is over. No network, no model, no database.
 *
 *   npm run check:live
 */
import { followRun, liveRun, trackRun } from "../lib/live";
import type { Claim, CompareEvent, ComparisonResult } from "../lib/types";

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (ok) console.log(`    ok    ${label}`);
  else {
    failures++;
    console.log(`    FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
};

const claim = (summary: string): CompareEvent => ({
  event: "claim",
  claim: { type: "unique", summary } as Claim,
});
const summaries = (events: CompareEvent[]) =>
  events.flatMap((e) => (e.event === "claim" ? [e.claim.summary] : []));

const result = { qid: "Q1" } as ComparisonResult;
const tick = () => new Promise((r) => setTimeout(r, 0));

console.log("\njoining a run in progress");

{
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));

  const owner: CompareEvent[] = [];
  const started = trackRun("k", (e) => owner.push(e), async (send) => {
    send(claim("one"));
    await gate;
    send(claim("two"));
    return result;
  });

  await tick();
  check(liveRun("k") !== undefined, "a run in progress is joinable by its key");
  check(liveRun("other") === undefined, "and only by its own key");

  const joined: CompareEvent[] = [];
  const following = followRun(liveRun("k")!, (e) => joined.push(e));
  check(summaries(joined).join() === "one", "joining replays what the run has already emitted");

  release();
  check((await following) === result, "a joiner gets the run's result");
  check(summaries(joined).join() === "one,two", "and everything emitted after it joined");
  check(summaries(owner).join() === "one,two", "the original reader sees the same events once");
  check((await started) === result, "the run itself resolves to its result");
  check(liveRun("k") === undefined, "a finished run is not joinable — its answer is cached");
}

{
  const failing = trackRun("boom", () => {}, async () => {
    throw new Error("no");
  });
  await failing.catch(() => {});
  check(liveRun("boom") === undefined, "a failed run is not joinable either");
}

{
  // A run whose starter emits nothing before a joiner arrives: nothing to
  // replay is not the same as nothing to follow.
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const started = trackRun("quiet", () => {}, async (send) => {
    await gate;
    send(claim("late"));
    return result;
  });
  await tick();
  const joined: CompareEvent[] = [];
  const following = followRun(liveRun("quiet")!, (e) => joined.push(e));
  release();
  await following;
  await started;
  check(summaries(joined).join() === "late", "a joiner ahead of the first event still gets it");
}

console.log(failures ? `\n${failures} check(s) failed\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
