/**
 * Does asking every Choice in both option orders pay for itself?
 *
 *   npm run jev:order -- [slug] [--runs=2]
 *   npm run jev:order -- [slug] --stub      # no key: request counts and token ratio only
 *
 * Runs the fixture `runs` times as shipped (both orders) and once forward-only,
 * then reports: how far the two orders disagree on each question, what a
 * forward-only answer would have changed, the claims and gold score of each run,
 * and what each run cost. Writes reports/jev/<slug>.order.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureSnapshots, loadFixture } from "../fixtures/loader";
import { Jev, type Answer, type Ask } from "../lib/jev/client";
import { JEV_LANGS, runJevComparison, type JevRun } from "../lib/jev/pipeline";
import { salientClaims } from "../lib/salience";
import type { Claim, Lang } from "../lib/types";
import { TypeSafeClient, choice } from "@typesafe-ai/sdk";

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--")) ?? "palestinian-legislative-council";
const runs = Number(args.find((a) => a.startsWith("--runs="))?.slice(7) ?? 2);
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "reports", "jev");
mkdirSync(OUT, { recursive: true });

const useStub = args.includes("--stub");
if (!useStub && !process.env.TYPESAFE_API_KEY) {
  console.error("Set TYPESAFE_API_KEY (e.g. in .env.local).");
  process.exit(1);
}

interface Record_ {
  id: string;
  options: string[];
  f: Record<string, number>;
  r: Record<string, number>;
}

/** Answers that depend on the question text and label but not on the option
 *  order, so both modes take the same path and only their request shapes differ. */
const hash = (text: string) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const stub = new TypeSafeClient({
  apiKey: "stub",
  retry: { maxRetries: 0 },
  fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    const answers: Record<string, unknown> = {};
    for (const [name, q] of Object.entries<{ type: string; instructions: string; criteria: unknown }>(body.questions)) {
      if (q.type === "score") {
        answers[name] = { type: "score", score: hash(q.instructions) % 3, confidence: 0.7, probabilities: {}, legend: {} };
        continue;
      }
      const labels = Object.keys(q.criteria as object);
      const w = labels.map((l) => Math.exp((hash(q.instructions + l) % 1000) / 200));
      const total = w.reduce((a, b) => a + b, 0);
      const probabilities = Object.fromEntries(labels.map((l, i) => [l, w[i] / total]));
      const best = labels[w.indexOf(Math.max(...w))];
      answers[name] = { type: "choice", choice: best, confidence: probabilities[best], probabilities };
    }
    const input = Math.ceil(JSON.stringify(body).length / 3.5);
    return new Response(JSON.stringify({ model: "jev-stub", answers, usage: { input_tokens: input, output_tokens: 0 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  },
});
const client = useStub ? stub : undefined;

const criteria = (options: Ask["options"]) => Object.fromEntries(options);
const argmax = (p: Record<string, number>) => Object.entries(p).reduce((a, b) => (b[1] > a[1] ? b : a))[0];

/** The shipped client, but keeping both orders' distributions for analysis. */
class RecordingJev extends Jev {
  records: Record_[] = [];
  async choices(state: Parameters<Jev["choices"]>[0], asks: Ask[]): Promise<Map<string, Answer>> {
    const answers = new Map<string, Answer>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this as any).send(
      state,
      asks.map((ask) => ({
        id: ask.id,
        questions: {
          [`${ask.id}.f`]: choice(ask.instructions, criteria(ask.options)),
          [`${ask.id}.r`]: choice(ask.instructions, criteria([...ask.options].reverse())),
        },
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (id: string, result: any) => {
        const ask = asks.find((a) => a.id === id)!;
        const f = result.answers[`${id}.f`];
        const r = result.answers[`${id}.r`];
        if (f?.type !== "choice" || r?.type !== "choice") return;
        const probabilities: Record<string, number> = {};
        for (const [label] of ask.options) probabilities[label] = ((f.probabilities[label] ?? 0) + (r.probabilities[label] ?? 0)) / 2;
        const best = argmax(probabilities);
        answers.set(id, { choice: best, confidence: probabilities[best], probabilities, orderAgreed: f.choice === r.choice });
        this.records.push({ id, options: ask.options.map(([l]) => l), f: f.probabilities, r: r.probabilities });
      },
    );
    return answers;
  }
}

/** What the pipeline would be with each Choice asked once, in the given order. */
class ForwardJev extends Jev {
  async choices(state: Parameters<Jev["choices"]>[0], asks: Ask[]): Promise<Map<string, Answer>> {
    const answers = new Map<string, Answer>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (this as any).send(
      state,
      asks.map((ask) => ({ id: ask.id, questions: { [ask.id]: choice(ask.instructions, criteria(ask.options)) } })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (id: string, result: any) => {
        const ask = asks.find((a) => a.id === id)!;
        const f = result.answers[id];
        if (f?.type !== "choice") return;
        const probabilities: Record<string, number> = {};
        for (const [label] of ask.options) probabilities[label] = f.probabilities[label] ?? 0;
        answers.set(id, { choice: f.choice, confidence: probabilities[f.choice] ?? 0, probabilities, orderAgreed: true });
      },
    );
    return answers;
  }
}

const kind = (id: string) =>
  id.endsWith(".type") ? "verdict" : id.endsWith(".pair") ? "pair" : /^f\d+$/.test(id) ? "figure" : "match";

/** The paragraphs a match keeps, as lib/jev/match.ts does. */
const kept = (p: Record<string, number>) =>
  Object.entries(p)
    .filter(([l, v]) => l !== "none" && v >= 0.15)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([l]) => l)
    .sort()
    .join(",");

function analyse(records: Record_[]) {
  const by = new Map<string, Record_[]>();
  for (const r of records) by.set(kind(r.id), [...(by.get(kind(r.id)) ?? []), r]);
  const out: Record<string, unknown> = {};
  for (const [k, rs] of by) {
    let disagree = 0, fwdChanges = 0, keptChanges = 0, tv = 0, firstLean = 0, lastLean = 0;
    const firstPicks: Record<string, number> = {};
    for (const r of rs) {
      const avg = Object.fromEntries(r.options.map((l) => [l, ((r.f[l] ?? 0) + (r.r[l] ?? 0)) / 2]));
      const fa = argmax(r.f), ra = argmax(r.r), aa = argmax(avg);
      if (fa !== ra) disagree++;
      if (fa !== aa) fwdChanges++;
      if (k === "match" && kept(r.f) !== kept(avg)) keptChanges++;
      tv += r.options.reduce((n, l) => n + Math.abs((r.f[l] ?? 0) - (r.r[l] ?? 0)), 0) / 2;
      // The label listed first in the forward order is last in the reversed one.
      const first = r.options[0], last = r.options[r.options.length - 1];
      firstLean += (r.f[first] ?? 0) - (r.r[first] ?? 0);
      lastLean += (r.r[last] ?? 0) - (r.f[last] ?? 0);
      if (fa !== aa) firstPicks[`${aa}→${fa}`] = (firstPicks[`${aa}→${fa}`] ?? 0) + 1;
    }
    const n = rs.length;
    out[k] = {
      questions: n,
      ordersDisagree: `${disagree} (${pct(disagree / n)})`,
      forwardOnlyWouldChangeAnswer: `${fwdChanges} (${pct(fwdChanges / n)})`,
      ...(k === "match" ? { forwardOnlyWouldChangeKeptCandidates: `${keptChanges} (${pct(keptChanges / n)})` } : {}),
      meanTotalVariation: (tv / n).toFixed(3),
      leanToFirstListed: signedPts(firstLean / n),
      leanToLastListedInReverse: signedPts(lastLean / n),
      changes: Object.fromEntries(Object.entries(firstPicks).sort((a, b) => b[1] - a[1]).slice(0, 8)),
    };
  }
  return out;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const signedPts = (x: number) => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)} pts`;

// The hand-checked differences from scripts/jev-run.mts.
const has = (c: Claim, lang: Lang, pattern: RegExp) => pattern.test(c.spans[lang] ?? "");
const GOLD: Record<string, { label: string; present: boolean; test: (c: Claim) => boolean }[]> = {
  "palestinian-legislative-council": [
    { label: "2006 seats", present: true, test: (c) => c.type === "contradiction" && has(c, "he", /76|43/) },
    { label: "1996 Fatah seats", present: true, test: (c) => c.type === "contradiction" && (has(c, "en", /\b62\b/) || has(c, "he", /68 מושבים/)) },
    { label: "speaker since", present: true, test: (c) => c.type === "contradiction" && (has(c, "he", /מאז 2009/) || has(c, "en", /Hamas since 18 February 2006/)) },
    { label: "Judea and Samaria framing", present: true, test: (c) => c.type === "framing" && has(c, "he", /יהודה ושומרון/) },
    { label: "gap he: Goldstone", present: true, test: (c) => c.type === "unique" && has(c, "en", /Goldstone/) },
    { label: "gap he: movement", present: true, test: (c) => c.type === "unique" && has(c, "en", /permit|freedom of movement/) },
    { label: "gap he: detention", present: true, test: (c) => c.type === "unique" && has(c, "en", /detain|detention|arrest/) },
    { label: "gap en: 2018 ruling", present: true, test: (c) => c.type === "unique" && has(c, "he", /2018/) && !!c.missingFrom?.includes("en") },
    { label: "gap en: East Jerusalem", present: true, test: (c) => c.type === "unique" && has(c, "he", /מזרח ירושלים/) },
    { label: "gap en: district seats", present: true, test: (c) => c.type === "unique" && has(c, "he", /נפת/) },
    { label: "no 132-seat contradiction", present: false, test: (c) => c.type === "contradiction" && has(c, "en", /comprises 132 members/) },
    { label: "Oslo II size (ar 83)", present: true, test: (c) => c.type === "contradiction" && has(c, "ar", /83/) },
    { label: "gap en/he: laws (ar)", present: true, test: (c) => c.type === "unique" && has(c, "ar", /قانون/) },
    { label: "gap en/he: speakers (ar)", present: true, test: (c) => c.type === "unique" && has(c, "ar", /رفيق النتشة|روحي فتوح|حسن خريشة/) },
  ],
};

const articles = fixtureSnapshots(loadFixture(slug)).filter((a) => JEV_LANGS.includes(a.lang));
const byLang = Object.fromEntries(articles.map((a) => [a.lang, a]));

function summarise(label: string, run: JevRun, ms: number) {
  const counts = run.claims.reduce<Record<string, number>>((a, c) => ({ ...a, [c.type]: (a[c.type] ?? 0) + 1 }), {});
  const shown = salientClaims(run.claims, byLang);
  const gold = (GOLD[slug] ?? []).map((e) => {
    const hits = run.claims.filter(e.test);
    return { label: e.label, ok: e.present ? hits.length > 0 : hits.length === 0, shown: hits.some((c) => shown.has(c.id)) };
  });
  return {
    label,
    claims: run.claims.length,
    counts,
    shownByDefault: shown.size,
    gold: GOLD[slug] ? `${gold.filter((g) => g.ok).length}/${gold.length} (shown ${gold.filter((g) => g.ok && g.shown).length})` : "n/a",
    goldMissed: gold.filter((g) => !g.ok).map((g) => g.label),
    requests: run.requests,
    inputTokens: run.usage.inputTokens,
    costCents: +((run.usage.costUsd ?? 0) * 100).toFixed(2),
    ms,
    stages: run.stages,
    keys: run.claims.map((c) => `${c.type}|${Object.entries(c.spans).sort().map(([l, s]) => `${l}:${s}`).join("|")}`),
  };
}

const results: ReturnType<typeof summarise>[] = [];
let records: Record_[] = [];
for (let i = 0; i < runs; i++) {
  const jev = new RecordingJev(client);
  const t = Date.now();
  const run = await runJevComparison(articles, undefined, jev);
  results.push(summarise(`both orders #${i + 1}`, run, Date.now() - t));
  if (i === 0) records = jev.records;
}
{
  const t = Date.now();
  const run = await runJevComparison(articles, undefined, new ForwardJev(client));
  results.push(summarise("forward only", run, Date.now() - t));
}

const overlap = (a: string[], b: string[]) => {
  const s = new Set(b);
  const inter = a.filter((k) => s.has(k)).length;
  return `${inter} shared of ${a.length} vs ${b.length} (Jaccard ${(inter / (a.length + b.length - inter)).toFixed(2)})`;
};

const onlyIn = (a: string[], b: string[]) => {
  const s = new Set(b);
  return a.filter((k) => !s.has(k) && !k.startsWith("unique|"));
};

const report = {
  slug,
  perQuestion: analyse(records),
  runs: results.map(({ keys: _keys, ...r }) => r),
  claimOverlap: {
    ...(results.length > 2 ? { "both#1 vs both#2 (noise floor)": overlap(results[0].keys, results[1].keys) } : {}),
    "both#1 vs forward": overlap(results[0].keys, results[results.length - 1].keys),
  },
  notUniqueOnlyInBoth: onlyIn(results[0].keys, results[results.length - 1].keys),
  notUniqueOnlyInForward: onlyIn(results[results.length - 1].keys, results[0].keys),
};
writeFileSync(join(OUT, `${slug}.order.json`), JSON.stringify({ ...report, records }, null, 2));
console.log(JSON.stringify(report, null, 2));
