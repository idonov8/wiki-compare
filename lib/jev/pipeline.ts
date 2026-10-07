import type { ArticleSnapshot, Claim, ComparisonScope, Lang, Usage } from "../types";
import { LANG_META } from "../types";
import { extractNumbers } from "../deterministic";
import { costOfUsage } from "../pricing";
import { Jev } from "./client";
import { classifySentences, type SentenceVerdict } from "./classify";
import { matchUnits, type Match } from "./match";
import { segment, type Paragraph, type Segmented, type Unit } from "./segment";

export const JEV_VERSION = "jev-v1";
/** The POC compares one pair. Both are required; any other language is ignored. */
export const JEV_LANGS: [Lang, Lang] = ["en", "he"];

/** A paragraph is a gap only when "none" is the more likely answer. */
const GAP_FLOOR = 0.5;
/** A second-chance match has to be at least this sure to move a sentence. */
const RECHECK_FLOOR = 0.4;
/** Flags weaker than this are noise with four options to choose from. */
const FLAG_FLOOR = 0.35;
/** The number check is code, not Jev, and only a hint: it says figures differ,
 *  not that they refer to the same quantity. */
const NUMBER_CONFIDENCE = 0.4;

export interface ParagraphTrace {
  id: string;
  heading: string;
  text: string;
  none: number;
  orderAgreed: boolean;
  candidates: { id: string; heading: string; p: number }[];
}

export interface DirectionTrace {
  from: Lang;
  to: Lang;
  paragraphs: ParagraphTrace[];
  verdicts: {
    sentence: string;
    verdict: string;
    confidence: number;
    probabilities: Record<string, number>;
    orderAgreed: boolean;
    counterpart?: string;
    rechecked?: boolean;
  }[];
}

interface Flag {
  type: Claim["type"];
  confidence: number;
  summary: string;
  explanation: string;
  spans: Partial<Record<Lang, string>>;
  /** For removing the same finding reached from both directions. */
  key: string;
}

async function direction(
  jev: Jev,
  from: Segmented,
  to: Segmented,
): Promise<{ flags: Flag[]; trace: DirectionTrace }> {
  const toName = LANG_META[to.lang].label;
  const flags: Flag[] = [];
  const trace: DirectionTrace = { from: from.lang, to: to.lang, paragraphs: [], verdicts: [] };

  const byKind = (s: Segmented, kind: Paragraph["kind"]) => s.paragraphs.filter((p) => p.kind === kind);
  const [body, facts] = await Promise.all(
    (["body", "facts"] as const).map((kind) => matchUnits(jev, from, to, byKind(from, kind), byKind(to, kind))),
  );
  const matches = new Map<string, Match>([...body, ...facts]);

  const toClassify: { paragraph: Paragraph; against: Paragraph[] }[] = [];
  for (const paragraph of from.paragraphs) {
    const match = matches.get(paragraph.id);
    if (!match) continue;
    trace.paragraphs.push({
      id: paragraph.id,
      heading: paragraph.heading,
      text: paragraph.text,
      none: match.none,
      orderAgreed: match.answer.orderAgreed,
      candidates: match.candidates.map((c) => ({ id: c.paragraph.id, heading: c.paragraph.heading, p: c.p })),
    });
    if (match.none >= GAP_FLOOR) {
      // An infobox field the other version lacks is a template difference, not
      // a finding about the subject.
      if (paragraph.kind === "body") {
        flags.push({
          type: "unique",
          confidence: match.none,
          summary: `No matching ${toName} paragraph`,
          explanation: `No paragraph of the ${toName} article covers this.`,
          spans: { [from.lang]: paragraph.text },
          key: `gap:${from.lang}:${paragraph.text}`,
        });
      }
      continue;
    }
    toClassify.push({ paragraph, against: match.candidates.map((c) => c.paragraph) });
  }

  const verdicts = (
    await Promise.all(
      toClassify.map(({ paragraph, against }) =>
        classifySentences(jev, from, to, paragraph.sentences, against, paragraph.id),
      ),
    )
  ).flat();

  // A sentence missing from the passage it was matched to may still be in the
  // article: the lead summarises what the body says elsewhere. Ask once more,
  // against every paragraph, before calling it a gap.
  const gaps = verdicts
    .map((v, i) => ({ v, id: `g${i}` }))
    .filter(({ v }) => v.verdict === "gap" && v.confidence >= FLAG_FLOOR);
  const rechecked = new Set<SentenceVerdict>();
  if (gaps.length) {
    const paragraphOf = (u: Unit) =>
      from.paragraphs.find((p) => p.section === u.section && p.start <= u.start && p.end >= u.end);
    const kindOf = (u: Unit) => paragraphOf(u)?.kind ?? "body";
    const units = gaps.map(({ v, id }) => ({ ...v.sentence, id }));
    const pool = (kind: Paragraph["kind"]) => to.paragraphs.filter((p) => p.kind === kind);
    const [bodyHomes, factHomes] = await Promise.all(
      (["body", "facts"] as const).map((kind) =>
        matchUnits(jev, from, to, units.filter((u) => kindOf(u) === kind), pool(kind)),
      ),
    );
    const homes = new Map([...bodyHomes, ...factHomes]);
    // Sentences of one paragraph that found the same new home share a request.
    const moves = new Map<string, { home: Paragraph; items: SentenceVerdict[] }>();
    for (const { v, id } of gaps) {
      const home = homes.get(id)?.candidates[0];
      if (!home || home.p < RECHECK_FLOOR || v.against.includes(home.paragraph)) continue;
      const key = `${paragraphOf(v.sentence)?.id}>${home.paragraph.id}`;
      const move = moves.get(key) ?? { home: home.paragraph, items: [] };
      move.items.push(v);
      moves.set(key, move);
    }
    await Promise.all(
      [...moves.entries()].map(async ([key, { home, items }]) => {
        const again = await classifySentences(jev, from, to, items.map((v) => v.sentence), [home], `re.${key}`);
        for (const verdict of again) {
          const before = items.find((v) => v.sentence === verdict.sentence);
          if (!before) continue;
          verdicts[verdicts.indexOf(before)] = verdict;
          rechecked.add(verdict);
        }
      }),
    );
  }

  for (const v of verdicts) {
    trace.verdicts.push({
      sentence: v.sentence.text,
      verdict: v.verdict,
      confidence: v.confidence,
      probabilities: v.answer.probabilities,
      orderAgreed: v.answer.orderAgreed,
      counterpart: v.counterpart?.unit.text,
      rechecked: rechecked.has(v) || undefined,
    });

    const flag = flagFor(v, from.lang, to.lang, toName);
    if (flag) flags.push(flag);
  }

  return { flags, trace };
}

function flagFor(v: SentenceVerdict, fromLang: Lang, toLang: Lang, toName: string): Flag | null {
  const spans: Partial<Record<Lang, string>> = { [fromLang]: v.sentence.text };
  if (v.counterpart) spans[toLang] = v.counterpart.unit.text;
  const pairKey = (a: string, b = "") => (fromLang < toLang ? `${a}|${b}` : `${b}|${a}`);

  if (v.verdict === "consistent") {
    // Jev reads figures as text, so a pair it calls consistent is checked for
    // numbers in code: each side holding a figure the other lacks.
    if (!v.counterpart) return null;
    const mine = extractNumbers(v.sentence.text);
    const theirs = extractNumbers(v.counterpart.unit.text);
    const onlyMine = [...mine].filter((n) => !theirs.has(n));
    const onlyTheirs = [...theirs].filter((n) => !mine.has(n));
    if (!onlyMine.length || !onlyTheirs.length) return null;
    return {
      type: "contradiction",
      confidence: NUMBER_CONFIDENCE,
      summary: "Figures differ",
      explanation: `The matched sentences give different figures: ${onlyMine.join(", ")} here, ${onlyTheirs.join(", ")} in the ${toName} article.`,
      spans,
      key: `contradiction:${pairKey(v.sentence.text, v.counterpart.unit.text)}`,
    };
  }

  if (v.confidence < FLAG_FLOOR) return null;
  const missing = v.counterpart ? "" : ` Jev could not point to the ${toName} sentence.`;
  switch (v.verdict) {
    case "gap":
      return {
        type: "unique",
        confidence: v.confidence,
        summary: `Not in the ${toName} article`,
        explanation: `The ${toName} article doesn't mention this.`,
        spans: { [fromLang]: v.sentence.text },
        key: `gap:${fromLang}:${v.sentence.text}`,
      };
    case "contradiction":
      return {
        type: "contradiction",
        confidence: v.confidence,
        summary: "Contradicting facts",
        explanation: `The ${toName} article states something incompatible here.${missing}`,
        spans,
        key: `contradiction:${pairKey(v.sentence.text, v.counterpart?.unit.text)}`,
      };
    case "framing":
      return {
        type: "framing",
        confidence: v.confidence,
        summary: "Different framing",
        explanation: `Both versions report this, but the ${toName} article describes it differently.${missing}`,
        spans,
        key: `framing:${pairKey(v.sentence.text, v.counterpart?.unit.text)}`,
      };
  }
}

export interface JevRun {
  claims: Claim[];
  usage: Usage;
  spans: { offered: number; matched: number; droppedClaims: number; samples: [] };
  scope: ComparisonScope;
  trace: DirectionTrace[];
  requests: number;
  /** What the planner estimated the same requests at, against `usage.inputTokens`. */
  estimatedTokens: number;
  /** Requests Jev refused as too large and that were split and resent. */
  splits: number;
}

/**
 * The Jev comparison: English and Hebrew, each paragraph matched to the other
 * article and each sentence of a matched paragraph classified.
 *
 * Same contract as `runComparison`, so the route, the cache and the columns take
 * it unchanged. Claims are delivered once both directions are merged, since a
 * contradiction found from both sides is one finding.
 */
export async function runJevComparison(
  articles: ArticleSnapshot[],
  onClaim?: (claim: Claim) => void,
  jev = new Jev(),
): Promise<JevRun> {
  const [a, b] = JEV_LANGS.map((lang) => articles.find((x) => x.lang === lang));
  if (!a || !b) {
    throw new Error("The Jev engine compares English with Hebrew, and this subject is missing one of them.");
  }
  const sa = segment(a);
  const sb = segment(b);

  const results = await Promise.all([direction(jev, sa, sb), direction(jev, sb, sa)]);

  const merged = new Map<string, Flag>();
  for (const flag of results.flatMap((r) => r.flags)) {
    const seen = merged.get(flag.key);
    if (!seen) merged.set(flag.key, flag);
    else if (flag.confidence > seen.confidence) merged.set(flag.key, { ...flag, spans: { ...seen.spans, ...flag.spans } });
  }

  const claims: Claim[] = [...merged.values()].map((f, i) => ({
    id: `j${i}`,
    type: f.type,
    summary: f.summary,
    explanation: f.explanation,
    spans: f.spans,
    confidence: Math.round(f.confidence * 100) / 100,
  }));
  for (const claim of claims) onClaim?.(claim);

  const usage: Usage = {
    inputTokens: jev.usage.inputTokens,
    outputTokens: jev.usage.outputTokens,
    cachedInputTokens: 0,
    byModel: {
      [jev.model]: { inputTokens: jev.usage.inputTokens, outputTokens: jev.usage.outputTokens, cachedInputTokens: 0 },
    },
  };
  usage.costUsd = costOfUsage(usage, jev.model);

  const spanCount = claims.reduce((n, c) => n + Object.keys(c.spans).length, 0);
  const counts = claims.reduce<Record<string, number>>((acc, c) => ({ ...acc, [c.type]: (acc[c.type] ?? 0) + 1 }), {});
  console.log(
    `[jev] ${a.title} / ${b.title}: paragraphs=${sa.paragraphs.length}/${sb.paragraphs.length} ` +
      `claims=${claims.length} ${JSON.stringify(counts)} requests=${jev.usage.requests} splits=${jev.usage.splits} ` +
      `tokens=${usage.inputTokens}in/${usage.outputTokens}out cost=$${usage.costUsd.toFixed(4)}`,
  );

  return {
    claims,
    usage,
    spans: { offered: spanCount, matched: spanCount, droppedClaims: 0, samples: [] },
    scope: { kind: "full" },
    trace: results.map((r) => r.trace),
    requests: jev.usage.requests,
    estimatedTokens: jev.usage.estimatedTokens,
    splits: jev.usage.splits,
  };
}
