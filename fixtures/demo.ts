import type { ArticleSnapshot, Claim, ComparisonResult, Lang } from "../lib/types";
import { coverageGaps } from "../lib/deterministic";
import { JEV_VERSION, runJevComparison } from "../lib/jev/pipeline";
import { fixtureLabels, fixtureSnapshots, loadFixture } from "./loader";

/**
 * A comparison assembled from a recorded fixture, for working on the rendering
 * layer without a database, an API key or a model call.
 *
 * The claims are not model output and are not represented as such — they are
 * built by locating real sentences in the parsed text, so every span is exact
 * by construction and exercises the same code path a real span would. The point
 * is to put realistic bidirectional text under the highlighter: numbers inside
 * Hebrew and Arabic sentences, Latin proper nouns inside RTL runs, and spans
 * that begin or end at a direction boundary.
 */

/** Grab the sentence containing `pattern`, so the span is guaranteed verbatim. */
function sentenceAround(text: string, pattern: RegExp, maxWords = 22): string | undefined {
  const match = pattern.exec(text);
  if (!match) return undefined;

  const start = Math.max(
    text.lastIndexOf("\n", match.index) + 1,
    text.lastIndexOf(". ", match.index) + 1,
    0,
  );
  const nl = text.indexOf("\n", match.index);
  const dot = text.indexOf(". ", match.index);
  const end = Math.min(
    nl === -1 ? text.length : nl,
    dot === -1 ? text.length : dot + 1,
    text.length,
  );

  const sentence = text.slice(start, end).trim();
  if (!sentence) return undefined;

  // Keep it short enough to read as a highlight rather than a paragraph, but
  // slice on whitespace so the result stays an exact substring.
  const words = sentence.split(/\s+/);
  if (words.length <= maxWords) return sentence;
  const shortened = words.slice(0, maxWords).join(" ");
  return sentence.startsWith(shortened) ? shortened : sentence;
}

const textOf = (snaps: ArticleSnapshot[], lang: Lang) =>
  snaps.find((s) => s.lang === lang)?.sections.map((s) => s.text).join("\n") ?? "";

interface Draft {
  type: Claim["type"];
  summary: string;
  explanation: string;
  find: Partial<Record<Lang, RegExp>>;
}

const DRAFTS: Record<string, Draft[]> = {
  "palestinian-legislative-council": [
    {
      type: "contradiction",
      summary: "2006 seat split differs",
      explanation:
        "Hebrew reports Hamas 76 and Fatah 43; English and Arabic both give 74 and 45. The Hebrew figure also disagrees with Hebrew Wikipedia's own article on that election, so it is the odd one out on a checkable number.",
      find: { he: /76/, en: /74/, ar: /74/ },
    },
    {
      type: "contradiction",
      summary: "Council size under Oslo II",
      explanation:
        "Arabic works from an 83-member council established by Oslo II; English and Hebrew both work from 88.",
      find: { ar: /83/, en: /\b88\b/, he: /88/ },
    },
    {
      type: "framing",
      summary: "Districts named differently",
      explanation:
        "Hebrew places the electoral districts in Judea and Samaria, English in the West Bank, and Arabic in the West Bank including East Jerusalem.",
      find: { he: /יהודה ושומרון/, en: /West Bank and (?:the )?Gaza Strip/, ar: /الضفة الغربية/ },
    },
    {
      type: "unique",
      summary: "Israeli restrictions covered only in English",
      explanation:
        "English devotes a section to movement permits, detention of members and the bombing of the PLC buildings. Neither other version covers this material.",
      find: { en: /Goldstone|detain|detention/ },
    },
    {
      type: "unique",
      summary: "Legislative record covered only in Arabic",
      explanation:
        "Arabic lists ratified laws, confidence votes and the budgets passed in 1997, 1999 and 2000. The other versions do not record the council's legislative output.",
      find: { ar: /1997/ },
    },
  ],
};

export function demoComparison(slug: string): ComparisonResult {
  const fixture = loadFixture(slug);
  const snaps = fixtureSnapshots(fixture);

  const claims: Claim[] = [];
  for (const [i, draft] of (DRAFTS[slug] ?? []).entries()) {
    const spans: Claim["spans"] = {};
    for (const [lang, pattern] of Object.entries(draft.find) as [Lang, RegExp][]) {
      const span = sentenceAround(textOf(snaps, lang), pattern);
      if (span) spans[lang] = span;
    }
    if (Object.keys(spans).length) {
      claims.push({ id: `demo${i}`, type: draft.type, summary: draft.summary, explanation: draft.explanation, spans });
    }
  }

  return {
    qid: fixture.qid,
    articles: Object.fromEntries(snaps.map((s) => [s.lang, s])),
    claims,
    coverage: coverageGaps(snaps, fixtureLabels(fixture)),
    promptVersion: "fixture",
    parserVersion: "fixture",
    computedAt: fixture.capturedAt,
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
    spans: { offered: 0, matched: 0, droppedClaims: 0 },
  };
}

/**
 * The same fixture read by the real Jev engine, when a TypeSafe key is set: the
 * claims, importance and sentence alignment the hover panel needs, on text that
 * needs no network beyond Jev itself. Keyed `demo:<slug>` so a development
 * database can store it and the explain route can find it.
 */
export async function demoJevComparison(slug: string): Promise<ComparisonResult> {
  const base = demoComparison(slug);
  const run = await runJevComparison(Object.values(base.articles));
  return {
    ...base,
    claims: run.claims,
    alignment: run.alignment,
    usage: run.usage,
    scope: run.scope,
    promptVersion: JEV_VERSION,
    cacheKey: `demo:${slug}`,
  };
}
