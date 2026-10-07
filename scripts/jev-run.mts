/**
 * Run the Jev engine on a recorded fixture and write a review page.
 *
 *   npm run jev:run                                   # palestinian-legislative-council
 *   npm run jev:run -- hadag-nahash
 *   npm run jev:run -- palestinian-legislative-council --from-json   # re-render, no calls
 *
 * Writes reports/jev/<slug>.json (claims and trace) and reports/jev/<slug>.html.
 * Needs TYPESAFE_API_KEY unless --from-json. For the PLC fixture it also scores
 * the run against the differences checked by hand in check-parser.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureSnapshots, loadFixture } from "../fixtures/loader";
import { JEV_LANGS, runJevComparison, type JevRun } from "../lib/jev/pipeline";
import { segment, type Segmented } from "../lib/jev/segment";
import { LANG_META, type Claim, type Lang } from "../lib/types";

const args = process.argv.slice(2);
const slug = args.find((a) => !a.startsWith("--")) ?? "palestinian-legislative-council";
const fromJson = args.includes("--from-json");
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "reports", "jev");
mkdirSync(OUT, { recursive: true });

const articles = fixtureSnapshots(loadFixture(slug)).filter((a) => JEV_LANGS.includes(a.lang));
const jsonPath = join(OUT, `${slug}.json`);

let run: JevRun & { ms: number };
if (fromJson) {
  run = { estimatedTokens: 0, splits: 0, ...JSON.parse(readFileSync(jsonPath, "utf8")) };
} else {
  if (!process.env.TYPESAFE_API_KEY) {
    console.error("Set TYPESAFE_API_KEY, or pass --from-json to re-render the last run.");
    process.exit(1);
  }
  const started = Date.now();
  run = { ...(await runJevComparison(articles)), ms: 0 };
  run.ms = Date.now() - started;
  writeFileSync(jsonPath, JSON.stringify(run, null, 2));
}

// --- gold ------------------------------------------------------------------

interface Expectation {
  label: string;
  /** false: the run should *not* produce a claim like this. */
  present: boolean;
  test: (c: Claim) => boolean;
}

const has = (c: Claim, lang: Lang, pattern: RegExp) => pattern.test(c.spans[lang] ?? "");

const GOLD: Record<string, Expectation[]> = {
  "palestinian-legislative-council": [
    { label: "contradiction: 2006 seats (he 76/43 vs en 74)", present: true, test: (c) => c.type === "contradiction" && has(c, "he", /76|43/) },
    { label: "contradiction: 1996 Fatah seats (en 62 vs he 68)", present: true, test: (c) => c.type === "contradiction" && (has(c, "en", /\b62\b/) || has(c, "he", /68 מושבים/)) },
    { label: "contradiction: speaker since (en 2006 vs he 2009)", present: true, test: (c) => c.type === "contradiction" && (has(c, "he", /מאז 2009/) || has(c, "en", /Hamas since 18 February 2006/)) },
    { label: "framing: Judea and Samaria vs West Bank", present: true, test: (c) => c.type === "framing" && has(c, "he", /יהודה ושומרון/) },
    { label: "gap in he: Goldstone Mission", present: true, test: (c) => c.type === "unique" && has(c, "en", /Goldstone/) },
    { label: "gap in he: movement restrictions", present: true, test: (c) => c.type === "unique" && has(c, "en", /permit|freedom of movement/) },
    { label: "gap in he: detention of members", present: true, test: (c) => c.type === "unique" && has(c, "en", /detain|detention|arrest/) },
    { label: "gap in en: 2018 constitutional court ruling", present: true, test: (c) => c.type === "unique" && has(c, "he", /2018/) },
    { label: "gap in en: postponed over East Jerusalem", present: true, test: (c) => c.type === "unique" && has(c, "he", /מזרח ירושלים/) },
    { label: "gap in en: district seat breakdown", present: true, test: (c) => c.type === "unique" && has(c, "he", /נפת/) },
    { label: "no contradiction on 132 seats", present: false, test: (c) => c.type === "contradiction" && has(c, "en", /comprises 132 members/) },
  ],
};

const gold = (GOLD[slug] ?? []).map((e) => {
  const hits = run.claims.filter(e.test);
  const ok = e.present ? hits.length > 0 : hits.length === 0;
  const best = Math.max(0, ...hits.map((c) => c.confidence ?? 0));
  return { ...e, ok, hits: hits.length, best };
});

// --- console summary --------------------------------------------------------

const counts = run.claims.reduce<Record<string, number>>((a, c) => ({ ...a, [c.type]: (a[c.type] ?? 0) + 1 }), {});
const verdicts = run.trace.flatMap((t) => t.verdicts);
const matchAgree = run.trace.flatMap((t) => t.paragraphs).filter((p) => p.orderAgreed).length;
const matchTotal = run.trace.flatMap((t) => t.paragraphs).length;
const typeAgree = verdicts.filter((v) => v.orderAgreed).length;

console.log(`\n${slug}: ${run.claims.length} claims ${JSON.stringify(counts)}`);
console.log(
  `  ${run.requests} requests, ${run.usage.inputTokens} input tokens, $${(run.usage.costUsd ?? 0).toFixed(4)}, ${(run.ms / 1000).toFixed(1)}s`,
);
console.log(
  `  option-order agreement: paragraphs ${matchAgree}/${matchTotal}, sentences ${typeAgree}/${verdicts.length}`,
);
console.log(
  `  token estimate: ${run.estimatedTokens} estimated vs ${run.usage.inputTokens} actual ` +
    `(${run.estimatedTokens ? (run.usage.inputTokens / run.estimatedTokens).toFixed(2) : "?"}x), ${run.splits} request(s) split as too large`,
);
if (gold.length) {
  console.log(`\n  gold: ${gold.filter((g) => g.ok).length}/${gold.length}`);
  for (const g of gold) {
    console.log(`    ${g.ok ? "ok  " : "MISS"}  ${g.label}${g.hits ? `  (${g.hits} claim(s), best ${Math.round(g.best * 100)}%)` : ""}`);
  }
}

// --- report -----------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (p: number) => `${Math.round(p * 100)}%`;

function marked(text: string, lang: Lang): string {
  const ranges: { start: number; end: number; claim: Claim }[] = [];
  for (const claim of run.claims) {
    const span = claim.spans[lang];
    if (!span) continue;
    const start = text.indexOf(span);
    if (start >= 0) ranges.push({ start, end: start + span.length, claim });
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  let out = "";
  let at = 0;
  for (const r of ranges) {
    if (r.start < at) continue;
    out += esc(text.slice(at, r.start));
    const c = r.claim;
    const title = `${c.type} · ${pct(c.confidence ?? 0)}\n${c.summary}\n${c.explanation}`;
    out += `<mark class="${c.type}" style="--c:${c.confidence ?? 1}" title="${esc(title)}">${esc(text.slice(r.start, r.end))}</mark>`;
    at = r.end;
  }
  return out + esc(text.slice(at));
}

function column(s: Segmented): string {
  const trace = run.trace.find((t) => t.from === s.lang)!;
  const other = JEV_LANGS.find((l) => l !== s.lang)!;
  let html = "";
  let heading = "";
  for (const p of s.paragraphs) {
    if (p.heading !== heading) {
      heading = p.heading;
      html += `<h3>${esc(heading)}</h3>`;
    }
    const m = trace.paragraphs.find((x) => x.id === p.id);
    const match = m
      ? `${p.id} → ${m.candidates.map((c) => `${other}:${c.id} ${pct(c.p)}`).join(", ")} · none ${pct(m.none)}${m.orderAgreed ? "" : " · <b>orders disagree</b>"}`
      : p.id;
    html += `<div class="para"><div class="match" dir="ltr">${match}</div><p>${marked(p.text, s.lang)}</p></div>`;
  }
  return `<section dir="${LANG_META[s.lang].dir}"><h2>${esc(s.title)} (${s.lang})</h2>${html}</section>`;
}

const segmented = JEV_LANGS.map((l) => segment(articles.find((a) => a.lang === l)!));
const goldHtml = gold.length
  ? `<ul class="gold">${gold.map((g) => `<li class="${g.ok ? "ok" : "miss"}">${g.ok ? "✓" : "✗"} ${esc(g.label)}${g.hits ? ` <span>${g.hits} claim(s), best ${pct(g.best)}</span>` : ""}</li>`).join("")}</ul>`
  : "";

const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jev run: ${esc(slug)}</title>
<style>
:root{--ink:#1d1d1b;--soft:#6b6b66;--paper:#fbfaf6;--rule:#dcd9cf;--contradiction:168,50,43;--unique:44,107,88;--framing:107,78,158}
@media (prefers-color-scheme: dark){:root{--ink:#ecebe6;--soft:#a5a39b;--paper:#1b1b19;--rule:#3a3935}}
body{margin:0;padding:16px;background:var(--paper);color:var(--ink);font:15px/1.6 Georgia,serif}
header{max-width:1200px;margin:0 auto 16px}header p{color:var(--soft);font:13px/1.5 ui-monospace,monospace;margin:4px 0}
.gold{font:13px/1.7 ui-monospace,monospace;padding-left:0;list-style:none}.gold .miss{color:rgb(var(--contradiction))}.gold span{color:var(--soft)}
main{display:grid;grid-template-columns:1fr 1fr;gap:24px;max-width:1200px;margin:0 auto}
@media (max-width:760px){main{grid-template-columns:1fr}}
section{min-width:0}h2{font-size:18px}h3{font:600 12px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.06em;color:var(--soft);margin:20px 0 6px}
.para{border-top:1px solid var(--rule);padding:6px 0}.match{font:11px/1.4 ui-monospace,monospace;color:var(--soft)}
p{margin:4px 0;white-space:pre-wrap}
mark{color:inherit;border-radius:2px;cursor:help;padding:.05em 0}
mark.contradiction{background:rgba(var(--contradiction),calc(.12 + .45*var(--c)));box-shadow:inset 0 -2px rgba(var(--contradiction),var(--c))}
mark.unique{background:rgba(var(--unique),calc(.12 + .45*var(--c)));box-shadow:inset 0 -2px rgba(var(--unique),var(--c))}
mark.framing{background:rgba(var(--framing),calc(.12 + .45*var(--c)));box-shadow:inset 0 -2px rgba(var(--framing),var(--c))}
</style></head><body>
<header><h1>Jev run: ${esc(slug)}</h1>
<p>${run.claims.length} claims ${esc(JSON.stringify(counts))} · ${run.requests} requests · ${run.usage.inputTokens} input tokens · $${(run.usage.costUsd ?? 0).toFixed(4)} · ${(run.ms / 1000).toFixed(1)}s</p>
<p>option-order agreement: paragraphs ${matchAgree}/${matchTotal}, sentences ${typeAgree}/${verdicts.length} · tokens ${run.usage.inputTokens} actual vs ${run.estimatedTokens} estimated · ${run.splits} split · opacity = confidence · hover a mark for details</p>
${goldHtml}</header>
<main>${segmented.map(column).join("")}</main></body></html>`;

const htmlPath = join(OUT, `${slug}.html`);
writeFileSync(htmlPath, html);
console.log(`\n  report: ${htmlPath}\n`);
