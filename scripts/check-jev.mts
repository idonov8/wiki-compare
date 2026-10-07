/**
 * The Jev pipeline end to end against a stub of the API. No network, no key.
 *
 *   npm run check:jev
 *
 * What it can prove without the model: every request fits the API's limits,
 * every question is well formed, and every claim the pipeline emits can be
 * highlighted, i.e. each of its spans is found verbatim in its article.
 */
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { fixtureSnapshots, listFixtures, loadFixture } from "../fixtures/loader";
import { Jev, estimateTokens } from "../lib/jev/client";
import { matchUnits } from "../lib/jev/match";
import { JEV_LANGS, runJevComparison } from "../lib/jev/pipeline";
import { segment } from "../lib/jev/segment";
import type { Lang } from "../lib/types";

let failures = 0;

function check(ok: boolean, label: string, detail = ""): void {
  if (ok) {
    console.log(`    ok    ${label}`);
  } else {
    failures++;
    console.log(`    FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

interface Body {
  state: unknown;
  questions: Record<string, { type: string; instructions: string; criteria: Record<string, unknown> }>;
}

/** Answers like a model that has read nothing: probability mass on the option
 *  whose text shares the most digits with the question, which is enough to send
 *  every branch of the pipeline some traffic. A bare-ID option's text is looked
 *  up in the state's ID-tagged lines, as the model is meant to. */
function stubAnswers(body: Body) {
  const tagged = new Map<string, string>();
  for (const value of Object.values(body.state as Record<string, unknown>)) {
    for (const m of String(value).matchAll(/^(\w+)\| (.*)$/gm)) tagged.set(m[1], m[2]);
  }
  const answers: Record<string, unknown> = {};
  for (const [name, q] of Object.entries(body.questions)) {
    const labels = Object.keys(q.criteria);
    const digits = new Set(String(q.instructions).match(/\d+/g) ?? []);
    const scored = labels.map((l, i) => {
      const text = q.criteria[l] === null ? (tagged.get(l) ?? "") : JSON.stringify(q.criteria[l]);
      const shared = (text.match(/\d+/g) ?? []).filter((d) => digits.has(d)).length;
      // Some sentences come back as gaps, so the re-check path is exercised too.
      const gap = l === "gap" && String(q.instructions).length % 3 === 0 ? 2 : 0;
      return shared + gap + (i === 0 ? 0.5 : 0) + ((name.length + i) % 3) * 0.1;
    });
    const weights = scored.map((x) => Math.exp(4 * x));
    const total = weights.reduce((a, b) => a + b, 0);
    const probabilities = Object.fromEntries(labels.map((l, i) => [l, weights[i] / total]));
    const best = labels[scored.indexOf(Math.max(...scored))];
    answers[name] = { type: "choice", choice: best, confidence: probabilities[best], probabilities };
  }
  return answers;
}

const problems: string[] = [];
let requests = 0;
const stub = new TypeSafeClient({
  apiKey: "stub",
  retry: { maxRetries: 0 },
  fetch: async (_url, init) => {
    requests++;
    const body = JSON.parse(String(init?.body)) as Body;
    const total = estimateTokens(body);
    if (total > 60_000) problems.push(`request of ~${total} tokens`);
    const state = estimateTokens(body.state);
    for (const [name, q] of Object.entries(body.questions)) {
      const labels = Object.keys(q.criteria);
      if (q.type !== "choice") problems.push(`${name}: type ${q.type}`);
      if (labels.length < 2 || labels.length > 255) problems.push(`${name}: ${labels.length} options`);
      if (state + estimateTokens(q) > 32_000) problems.push(`${name}: state + question ~${state + estimateTokens(q)} tokens`);
    }
    return new Response(
      JSON.stringify({ model: "jev-stub", answers: stubAnswers(body), usage: { input_tokens: total, output_tokens: 0 } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  },
});

for (const slug of listFixtures()) {
  const articles = fixtureSnapshots(loadFixture(slug)).filter((a) => JEV_LANGS.includes(a.lang));
  if (articles.length < 2) continue;
  console.log(`\n${slug}`);
  problems.length = 0;
  requests = 0;

  const streamed: string[] = [];
  const run = await runJevComparison(articles, (c) => streamed.push(c.id), new Jev(stub));

  check(!problems.length, "every request fits the API's limits", problems.slice(0, 3).join("; "));
  check(run.claims.length > 0, "the stub run produces claims", `${requests} requests`);
  check(streamed.length === run.claims.length, "every claim is streamed once");

  const unplaceable = run.claims.filter((c) =>
    (Object.entries(c.spans) as [Lang, string][]).some(
      ([lang, span]) => !articles.find((a) => a.lang === lang)?.sections.some((s) => s.text.includes(span)),
    ),
  );
  check(!unplaceable.length, "every span is found verbatim in its article", unplaceable[0]?.summary);
  check(
    run.claims.every((c) => c.confidence !== undefined && c.confidence > 0 && c.confidence <= 1),
    "every claim carries a confidence in (0, 1]",
  );
  check(new Set(run.claims.map((c) => c.id)).size === run.claims.length, "claim ids are unique");
  check(run.usage.byModel?.["jev-stub"]?.inputTokens === run.usage.inputTokens, "usage is filed under the model");
  check(
    run.trace.some((t) => t.verdicts.some((v) => v.rechecked)) || !run.claims.some((c) => c.type === "unique"),
    "gaps go through the re-check",
  );
}

console.log("\ntournament: a pool past the 255-option limit");
{
  problems.length = 0;
  requests = 0;
  const [en, he] = JEV_LANGS.map((l) => segment(fixtureSnapshots(loadFixture("coffee")).find((a) => a.lang === l)!));
  const big = [0, 1, 2].flatMap((k) =>
    en.paragraphs.filter((p) => p.kind === "body").map((p) => ({ ...p, id: `${p.id}x${k}` })),
  );
  const units = he.paragraphs.filter((p) => p.kind === "body").slice(0, 5);
  const matches = await matchUnits(new Jev(stub), he, { ...en, paragraphs: big }, units, big);
  check(big.length > 255, `the pool has ${big.length} paragraphs`);
  check(!problems.length, "every request fits the API's limits", problems.slice(0, 3).join("; "));
  check(matches.size === units.length, "every unit gets an answer", `${matches.size}/${units.length}`);
  check(
    [...matches.values()].every((m) => m.candidates.length > 0 && m.candidates.every((c) => big.includes(c.paragraph))),
    "candidates come from the pool",
  );
}

console.log(failures ? `\n${failures} check(s) failed\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
