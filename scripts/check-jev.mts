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
import { Jev } from "../lib/jev/client";
import { matchUnits } from "../lib/jev/match";
import { JEV_LANGS, runJevComparison } from "../lib/jev/pipeline";
import { segment } from "../lib/jev/segment";
import { salientClaims } from "../lib/salience";
import type { AlignedSentence, Lang, TextRef } from "../lib/types";

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
  questions: Record<string, { type: string; instructions: string; criteria: Record<string, unknown> | unknown[] }>;
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
    if (q.type === "score") {
      const levels = (q.criteria as unknown[]).length;
      const level = String(q.instructions).length % levels;
      const probabilities = Object.fromEntries([...Array(levels).keys()].map((i) => [i, i === level ? 0.7 : 0.3 / (levels - 1)]));
      answers[name] = { type: "score", score: level, confidence: 0.7, probabilities, legend: {} };
      continue;
    }
    const criteria = q.criteria as Record<string, unknown>;
    const labels = Object.keys(criteria);
    const digits = new Set(String(q.instructions).match(/\d+/g) ?? []);
    const scored = labels.map((l, i) => {
      const text = criteria[l] === null ? (tagged.get(l) ?? "") : JSON.stringify(criteria[l]);
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

/** A harsher tokenizer than the planner's estimate: three Latin characters a
 *  token and one and a half tokens a Hebrew character. The stub enforces the
 *  real limits with it and refuses the way the API does, so the pipeline has to
 *  recover from being wrong about sizes rather than merely be right. */
function strictTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let ascii = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 128) ascii++;
  return Math.ceil(ascii / 3 + (text.length - ascii) * 1.5);
}

const problems: string[] = [];
let requests = 0;
let refusals = 0;
const limits = { request: 64_000, question: 32_000 };
const stub = new TypeSafeClient({
  apiKey: "stub",
  retry: { maxRetries: 0 },
  fetch: async (_url, init) => {
    requests++;
    const body = JSON.parse(String(init?.body)) as Body;
    const total = strictTokens(body);
    const state = strictTokens(body.state);
    const longest = Math.max(...Object.values(body.questions).map((q) => strictTokens(q)));
    for (const [name, q] of Object.entries(body.questions)) {
      const labels = Object.keys(q.criteria);
      if (q.type !== "choice" && q.type !== "score") problems.push(`${name}: type ${q.type}`);
      if (labels.length < 2 || labels.length > 255) problems.push(`${name}: ${labels.length} options`);
    }
    if (total > limits.request || state + longest > limits.question) {
      refusals++;
      return new Response(JSON.stringify({ detail: { error_type: "max_tokens_exceeded" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
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
  refusals = 0;

  const streamed: string[] = [];
  const run = await runJevComparison(articles, (c) => streamed.push(c.id), new Jev(stub));

  check(!problems.length, "every question is well formed", problems.slice(0, 3).join("; "));
  check(run.claims.length > 0, "the stub run completes with claims", `${requests} requests, ${refusals} refused as too large`);
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
  console.log(`          ${requests} requests, ${refusals} refused and split, estimate ${run.estimatedTokens} vs strict ${run.usage.inputTokens}`);
  check(run.usage.byModel?.["jev-stub"]?.inputTokens === run.usage.inputTokens, "usage is filed under the model");
  check(
    run.trace.some((t) => t.verdicts.some((v) => v.rechecked)) || !run.claims.some((c) => c.type === "unique"),
    "gaps go through the re-check",
  );

  const textAt = (lang: Lang, r: TextRef) =>
    articles.find((a) => a.lang === lang)?.sections[r.section]?.text.slice(r.start, r.end);
  const misreferenced = run.claims.filter((c) =>
    (Object.entries(c.refs ?? {}) as [Lang, TextRef][]).some(([lang, r]) => textAt(lang, r) !== c.spans[lang]),
  );
  check(!misreferenced.length && run.claims.every((c) => c.refs), "every claim's refs point at its spans", misreferenced[0]?.summary);
  check(
    run.claims.every((c) => typeof c.importance === "number" && c.importance >= 0 && c.importance <= 3),
    "every claim carries an importance in [0, 3]",
  );
  const groups = new Map<string, number[]>();
  for (const c of run.claims) if (c.group) groups.set(c.group, [...(groups.get(c.group) ?? []), c.importance!]);
  check([...groups.values()].every((v) => new Set(v).size === 1), "a missing paragraph is scored once, as a whole");
  check(
    run.claims.filter((c) => c.type === "unique").every((c) => c.missingFrom?.length && !c.missingFrom.some((l) => c.spans[l])),
    "every gap names the languages it is missing from, and none it is in",
  );

  const sentences = articles.reduce((n, a) => n + segment(a).paragraphs.reduce((m, p) => m + p.sentences.length, 0), 0);
  const rows = Object.values(run.alignment).flat();
  check(rows.length === sentences, "the alignment has a row for every sentence", `${rows.length}/${sentences}`);
  const others = (lang: Lang) => articles.map((a) => a.lang).filter((l) => l !== lang);
  const badRows = (Object.entries(run.alignment) as [Lang, AlignedSentence[]][]).flatMap(([lang, list]) =>
    list.filter(
      (row) =>
        !textAt(lang, row) ||
        !others(lang).every((o) => o in row.to) ||
        Object.entries(row.to).some(
          ([o, c]) => c && (!textAt(o as Lang, c.paragraph) || (c.sentence && !textAt(o as Lang, c.sentence))),
        ),
    ),
  );
  check(!badRows.length, "every alignment row points at real text in every other language", JSON.stringify(badRows[0])?.slice(0, 120));
  const shown = salientClaims(run.claims, Object.fromEntries(articles.map((a) => [a.lang, a])));
  check([...shown].every((id) => run.claims.some((c) => c.id === id)), "the threshold selects among the claims");
}

console.log("\ntournament: a pool past the 255-option limit");
{
  problems.length = 0;
  requests = 0;
  refusals = 0;
  const [en, he] = JEV_LANGS.map((l) => segment(fixtureSnapshots(loadFixture("coffee")).find((a) => a.lang === l)!));
  const big = [0, 1, 2].flatMap((k) =>
    en.paragraphs.filter((p) => p.kind === "body").map((p) => ({ ...p, id: `${p.id}x${k}` })),
  );
  const units = he.paragraphs.filter((p) => p.kind === "body").slice(0, 5);
  const matches = await matchUnits(new Jev(stub), he, { ...en, paragraphs: big }, units, big);
  check(big.length > 255, `the pool has ${big.length} paragraphs`);
  check(!problems.length, "every question is well formed", problems.slice(0, 3).join("; "));
  check(matches.size === units.length, "every unit gets an answer", `${matches.size}/${units.length}`);
  check(
    [...matches.values()].every((m) => m.candidates.length > 0 && m.candidates.every((c) => big.includes(c.paragraph))),
    "candidates come from the pool",
  );
}

console.log("\nrecovery: a model with an eighth of the limits");
{
  limits.request = 5_000;
  limits.question = 4_000;
  problems.length = 0;
  requests = 0;
  refusals = 0;
  const articles = fixtureSnapshots(loadFixture("palestinian-legislative-council")).filter((a) => JEV_LANGS.includes(a.lang));
  let error = "";
  const run = await runJevComparison(articles, undefined, new Jev(stub)).catch((e) => {
    error = e instanceof Error ? e.message : String(e);
    return null;
  });
  check(!!run, "the run completes although requests are refused", error);
  check(refusals > 0 && (run?.splits ?? 0) > 0, "refused requests are split and resent", `${refusals} refused`);
  limits.request = 64_000;
  limits.question = 32_000;
}

console.log(failures ? `\n${failures} check(s) failed\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
