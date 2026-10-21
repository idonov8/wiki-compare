import type {
  AlignedSentence,
  Alignment,
  ArticleSnapshot,
  Claim,
  ComparisonScope,
  Counterpart,
  Lang,
  TextRef,
  Usage,
} from "../types";
import { LANGS, LANG_META } from "../types";
import { extractNumbers } from "../deterministic";
import { costOfUsage } from "../pricing";
import { Jev, type Rate } from "./client";
import { classifySentences, type SentenceVerdict } from "./classify";
import { matchUnits, type Match } from "./match";
import { paragraphOf, segment, type Paragraph, type Segmented, type Unit } from "./segment";

/** v2: three languages, importance scores and the sentence alignment. */
export const JEV_VERSION = "jev-v2";
export const JEV_LANGS: readonly Lang[] = LANGS;

/** A paragraph is a gap only when "none" is the more likely answer. */
const GAP_FLOOR = 0.5;
/** A second-chance match has to be at least this sure to move a sentence. */
const RECHECK_FLOOR = 0.4;
/** Flags weaker than this are noise with four options to choose from. */
const FLAG_FLOOR = 0.35;
/** A figure difference Jev does not confirm refers to the same quantity is two
 *  sentences that happen to hold different numbers. */
const FIGURE_FLOOR = 0.35;

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

interface Direction {
  from: Segmented;
  to: Segmented;
  matches: Map<string, Match>;
  /** Paragraphs of `from` that nothing in `to` covers, with how sure that is. */
  gaps: Map<string, number>;
  verdicts: SentenceVerdict[];
  trace: DirectionTrace;
}

async function direction(jev: Jev, from: Segmented, to: Segmented): Promise<Direction> {
  const trace: DirectionTrace = { from: from.lang, to: to.lang, paragraphs: [], verdicts: [] };

  const byKind = (s: Segmented, kind: Paragraph["kind"]) => s.paragraphs.filter((p) => p.kind === kind);
  const [body, facts] = await Promise.all(
    (["body", "facts"] as const).map((kind) => matchUnits(jev, from, to, byKind(from, kind), byKind(to, kind))),
  );
  const matches = new Map<string, Match>([...body, ...facts]);
  const gaps = new Map<string, number>();

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
    if (match.none >= GAP_FLOOR) gaps.set(paragraph.id, match.none);
    else toClassify.push({ paragraph, against: match.candidates.map((c) => c.paragraph) });
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
  const recheck = verdicts
    .map((v, i) => ({ v, id: `g${i}` }))
    .filter(({ v }) => v.verdict === "gap" && v.confidence >= FLAG_FLOOR);
  const rechecked = new Set<SentenceVerdict>();
  if (recheck.length) {
    const kindOf = (u: Unit) => paragraphOf(from, u)?.kind ?? "body";
    const units = recheck.map(({ v, id }) => ({ ...v.sentence, id }));
    const [bodyHomes, factHomes] = await Promise.all(
      (["body", "facts"] as const).map((kind) =>
        matchUnits(jev, from, to, units.filter((u) => kindOf(u) === kind), byKind(to, kind)),
      ),
    );
    const homes = new Map([...bodyHomes, ...factHomes]);
    // Sentences of one paragraph that found the same new home share a request.
    const moves = new Map<string, { home: Paragraph; items: SentenceVerdict[] }>();
    for (const { v, id } of recheck) {
      const home = homes.get(id)?.candidates[0];
      if (!home || home.p < RECHECK_FLOOR || v.against.includes(home.paragraph)) continue;
      const key = `${paragraphOf(from, v.sentence)?.id}>${home.paragraph.id}`;
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
  }

  return { from, to, matches, gaps, verdicts, trace };
}

const ref = (u: TextRef): TextRef => ({ section: u.section, start: u.start, end: u.end });
const refKey = (lang: Lang, u: TextRef) => `${lang}:${u.section}:${u.start}`;
const names = (langs: Lang[]) => langs.map((l) => LANG_META[l].label).join(" or ");

interface Draft {
  type: Claim["type"];
  confidence: number;
  refs: Partial<Record<Lang, TextRef>>;
  texts: Partial<Record<Lang, string>>;
  /** Gaps only: per missing language, whether no paragraph matched at all. */
  missing?: Map<Lang, { confidence: number; paragraph: boolean }>;
  /** Code-detected figure differences, as text for the card. */
  figures?: string;
  /** Gaps only: the paragraph it belongs to, when the whole paragraph is missing
   *  from every language that lacks it, so the paragraph is scored once. */
  wholeParagraph?: string;
}

/**
 * Gaps are gathered per sentence, so one sentence missing from two languages is
 * one claim that says so. Contradictions and framing are joined wherever they
 * share a sentence, so the same disagreement found in two pairs carries a mark
 * in all three columns.
 */
function draftsFrom(directions: Direction[]): Draft[] {
  const gaps = new Map<string, Draft>();
  const pairs: Draft[] = [];

  const gap = (lang: Lang, u: Unit, missing: Lang, confidence: number, paragraph: boolean) => {
    const key = refKey(lang, u);
    const draft = gaps.get(key) ?? {
      type: "unique" as const,
      confidence: 0,
      refs: { [lang]: ref(u) },
      texts: { [lang]: u.text },
      missing: new Map(),
    };
    draft.missing!.set(missing, { confidence, paragraph });
    draft.confidence = Math.max(draft.confidence, confidence);
    gaps.set(key, draft);
  };

  for (const d of directions) {
    for (const paragraph of d.from.paragraphs) {
      const none = d.gaps.get(paragraph.id);
      // An infobox field the other version lacks is a template difference, not a
      // finding about the subject.
      if (none === undefined || paragraph.kind !== "body") continue;
      for (const s of paragraph.sentences) gap(d.from.lang, s, d.to.lang, none, true);
    }
    for (const v of d.verdicts) {
      const here = { [d.from.lang]: ref(v.sentence) };
      const there = v.counterpart ? { [d.to.lang]: ref(v.counterpart.unit) } : {};
      const texts = { [d.from.lang]: v.sentence.text, ...(v.counterpart ? { [d.to.lang]: v.counterpart.unit.text } : {}) };
      if (v.verdict === "gap" && v.confidence >= FLAG_FLOOR) {
        gap(d.from.lang, v.sentence, d.to.lang, v.confidence, false);
      } else if ((v.verdict === "contradiction" || v.verdict === "framing") && v.confidence >= FLAG_FLOOR) {
        pairs.push({ type: v.verdict, confidence: v.confidence, refs: { ...here, ...there }, texts });
      } else if (v.verdict === "consistent" && v.counterpart) {
        // Jev reads figures as text, so a pair it calls consistent is checked for
        // numbers in code: each side holding a figure the other lacks.
        const mine = extractNumbers(v.sentence.text);
        const theirs = extractNumbers(v.counterpart.unit.text);
        const onlyMine = [...mine].filter((n) => !theirs.has(n));
        const onlyTheirs = [...theirs].filter((n) => !mine.has(n));
        if (onlyMine.length && onlyTheirs.length) {
          pairs.push({
            type: "contradiction",
            confidence: 0,
            refs: { ...here, ...there },
            texts,
            figures: `${LANG_META[d.from.lang].label} gives ${onlyMine.join(", ")}, ${LANG_META[d.to.lang].label} gives ${onlyTheirs.join(", ")}.`,
          });
        }
      }
    }
  }

  // Union-find over sentence keys, one forest per claim type.
  const merged: Draft[] = [];
  for (const type of ["contradiction", "framing"] as const) {
    const parent = new Map<string, string>();
    const find = (k: string): string => {
      const p = parent.get(k) ?? k;
      if (p === k) return k;
      const root = find(p);
      parent.set(k, root);
      return root;
    };
    const keysOf = (d: Draft) => (Object.entries(d.refs) as [Lang, TextRef][]).map(([l, r]) => refKey(l, r));
    const ofType = pairs.filter((d) => d.type === type);
    for (const d of ofType) {
      const [first, ...rest] = keysOf(d);
      for (const k of rest) parent.set(find(k), find(first));
    }
    const groups = new Map<string, Draft>();
    for (const d of ofType) {
      const root = find(keysOf(d)[0]);
      const g = groups.get(root);
      if (!g) {
        groups.set(root, { ...d, refs: { ...d.refs }, texts: { ...d.texts } });
        continue;
      }
      for (const [l, r] of Object.entries(d.refs) as [Lang, TextRef][]) {
        g.refs[l] ??= r;
        g.texts[l] ??= d.texts[l];
      }
      // A figure difference is a weaker signal than Jev saying "contradiction";
      // the group keeps Jev's wording whenever Jev found it too.
      if (d.confidence > g.confidence) {
        g.confidence = d.confidence;
        g.figures = d.figures;
      }
    }
    merged.push(...groups.values());
  }

  for (const d of directions) {
    for (const paragraph of d.from.paragraphs) {
      for (const s of paragraph.sentences) {
        const draft = gaps.get(refKey(d.from.lang, s));
        if (draft && [...draft.missing!.values()].every((m) => m.paragraph)) {
          draft.wholeParagraph = `${d.from.lang}:${paragraph.id}`;
        }
      }
    }
  }

  return [...gaps.values(), ...merged];
}

/**
 * Code found different numbers in two sentences Jev matched; Jev decides whether
 * they are different values for the same thing. Reading what a figure refers to
 * is a question about language, unlike comparing the figures, which TypeSafe
 * says Jev should not be trusted with. Its answer is the claim's confidence.
 */
async function verifyFigures(jev: Jev, drafts: Draft[]): Promise<Draft[]> {
  const checked = drafts.filter((d) => d.figures);
  await Promise.all(
    checked.map(async (d, i) => {
      const langs = Object.keys(d.texts) as Lang[];
      const state = Object.fromEntries(langs.map((l) => [`${LANG_META[l].label.toLowerCase()}_sentence`, d.texts[l]!]));
      const answers = await jev.choices(state, [
        {
          id: `f${i}`,
          instructions: "Do these sentences give different values for the same quantity, date or count?",
          options: [
            ["different_values", "Yes: they state different values for the same quantity, date or count"],
            ["different_things", "No: the figures that differ measure different things, or one sentence has figures the other does not address"],
            ["same_values", "No: where they describe the same thing, the values agree"],
          ],
        },
      ]);
      d.confidence = answers.get(`f${i}`)?.probabilities.different_values ?? 0;
    }),
  );
  return drafts.filter((d) => !d.figures || d.confidence >= FIGURE_FLOOR);
}

function wording(d: Draft, present: Lang[]): { summary: string; explanation: string; missingFrom?: Lang[] } {
  if (d.type === "unique") {
    const missingFrom = present.filter((l) => d.missing!.has(l));
    const noParagraph = missingFrom.every((l) => d.missing!.get(l)!.paragraph);
    return {
      summary: `Not in the ${names(missingFrom)} article`,
      explanation: noParagraph
        ? `No paragraph of the ${names(missingFrom)} article covers this.`
        : `The ${names(missingFrom)} article doesn't mention this.`,
      missingFrom,
    };
  }
  const langs = present.filter((l) => d.refs[l]);
  if (d.type === "contradiction") {
    return {
      summary: d.figures ? "Figures differ" : "Contradicting facts",
      explanation: d.figures ?? `The ${names(langs).replace(/ or /g, " and ")} articles state incompatible facts here.`,
    };
  }
  return {
    summary: "Different framing",
    explanation: `The ${names(langs).replace(/ or /g, " and ")} articles report this but describe it differently.`,
  };
}

const RUBRIC: Rate["rubric"] = [
  "A minor detail: a date, figure, procedural step, list item or elaboration that does not change the picture of the subject",
  "Useful context, but the overall picture of the subject stays the same",
  "A notable fact, event, actor or claim about the subject",
  "Central or contested: it changes how a reader understands the subject, or concerns a disputed or politically sensitive point",
];

/**
 * How much each difference matters, as Jev's expected score on a four-level
 * rubric. One request per claim, since each needs its own passages as state;
 * they are small and run in parallel.
 */
async function importance(jev: Jev, drafts: Draft[], segs: Map<Lang, Segmented>, subject: string): Promise<number[]> {
  // A paragraph missing as a whole is judged as a whole: item by item, a list of
  // twelve districts is twelve minor details rather than one notable omission.
  const whole = new Map<string, Promise<number>>();
  const paragraphScore = (d: Draft, i: number) => {
    const key = d.wholeParagraph!;
    if (!whole.has(key)) {
      const lang = (Object.keys(d.refs) as Lang[])[0];
      const p = paragraphOf(segs.get(lang)!, d.refs[lang]!)!;
      const missing = names([...d.missing!.keys()]);
      whole.set(
        key,
        jev
          .scores(
            { subject, [`${LANG_META[lang].label.toLowerCase()}_paragraph`]: `[${p.heading}] ${p.text}` },
            [
              {
                id: `w${i}`,
                instructions: `The ${missing} Wikipedia article on this subject has nothing corresponding to this ${LANG_META[lang].label} paragraph. How much does a reader of the ${missing} article miss?`,
                rubric: RUBRIC,
              },
            ],
          )
          .then((r) => r.get(`w${i}`)?.score ?? 0),
      );
    }
    return whole.get(key)!;
  };

  return Promise.all(
    drafts.map(async (d, i) => {
      if (d.wholeParagraph) return paragraphScore(d, i);
      const langs = (Object.keys(d.refs) as Lang[]).filter((l) => segs.has(l));
      const state: Record<string, string> = { subject };
      for (const l of langs) {
        const p = paragraphOf(segs.get(l)!, d.refs[l]!);
        state[`${LANG_META[l].label.toLowerCase()}_passage`] = p ? `[${p.heading}] ${p.text}` : d.texts[l]!;
      }
      const quoted = (l: Lang) => `${LANG_META[l].label}: "${d.texts[l]}"`;
      const instructions =
        d.type === "unique"
          ? `The ${names([...d.missing!.keys()])} Wikipedia article on this subject does not contain this ${LANG_META[langs[0]].label} sentence: "${d.texts[langs[0]]}". How much does a reader of the ${names([...d.missing!.keys()])} article miss?`
          : d.type === "contradiction"
            ? `The Wikipedia articles disagree here. ${langs.map(quoted).join(" ")} How much does this disagreement matter to a reader trying to understand the subject?`
            : `The Wikipedia articles describe the same fact differently. ${langs.map(quoted).join(" ")} How much does this difference in framing matter to a reader trying to understand the subject?`;
      const ratings = await jev.scores(state, [{ id: `i${i}`, instructions, rubric: RUBRIC }]);
      return ratings.get(`i${i}`)?.score ?? 0;
    }),
  );
}

/** For every sentence, where each other language covers it. */
function alignmentOf(directions: Direction[], segs: Map<Lang, Segmented>): Alignment {
  const alignment: Alignment = {};
  for (const [lang, seg] of segs) {
    const outgoing = directions.filter((d) => d.from.lang === lang);
    const verdictOf = new Map(
      outgoing.flatMap((d) => d.verdicts.map((v) => [`${d.to.lang}|${refKey(lang, v.sentence)}`, v] as const)),
    );
    const rows: AlignedSentence[] = [];
    for (const paragraph of seg.paragraphs) {
      for (const s of paragraph.sentences) {
        const to: AlignedSentence["to"] = {};
        for (const d of outgoing) {
          if (d.gaps.has(paragraph.id)) {
            to[d.to.lang] = null;
            continue;
          }
          const v = verdictOf.get(`${d.to.lang}|${refKey(lang, s)}`);
          const match = d.matches.get(paragraph.id);
          let counterpart: Counterpart | undefined;
          if (v?.counterpart) {
            const home = paragraphOf(d.to, v.counterpart.unit) ?? v.against[0];
            counterpart = { paragraph: ref(home), sentence: ref(v.counterpart.unit), p: v.counterpart.p };
          } else if (v?.against[0] ?? match?.candidates[0]) {
            const c = v?.against[0] ?? match!.candidates[0].paragraph;
            counterpart = { paragraph: ref(c), p: match?.candidates[0]?.p ?? 0 };
          }
          if (counterpart) to[d.to.lang] = counterpart;
        }
        rows.push({ ...ref(s), paragraph: ref(paragraph), to });
      }
    }
    alignment[lang] = rows;
  }
  return alignment;
}

export interface JevRun {
  claims: Claim[];
  alignment: Alignment;
  usage: Usage;
  spans: { offered: number; matched: number; droppedClaims: number; samples: [] };
  scope: ComparisonScope;
  trace: DirectionTrace[];
  requests: number;
  /** What the planner estimated the same requests at, against `usage.inputTokens`. */
  estimatedTokens: number;
  /** Requests Jev refused as too large and that were split and resent. */
  splits: number;
  /** Input tokens by stage. */
  stages: { compare: number; verifyFigures: number; importance: number };
}

/**
 * The Jev comparison over every pair of the two or three languages present: each
 * paragraph matched to each other article, each sentence of a matched paragraph
 * classified, every difference scored for how much it matters.
 *
 * Claims are delivered once every pair is merged, since a contradiction found
 * from two sides is one finding.
 */
export async function runJevComparison(
  articles: ArticleSnapshot[],
  onClaim?: (claim: Claim) => void,
  jev = new Jev(),
): Promise<JevRun> {
  const present = JEV_LANGS.filter((l) => articles.some((a) => a.lang === l));
  if (present.length < 2) {
    throw new Error("A comparison needs at least two of the English, Hebrew and Arabic articles.");
  }
  const segs = new Map(present.map((l) => [l, segment(articles.find((a) => a.lang === l)!)] as const));

  const directions = await Promise.all(
    present.flatMap((from) =>
      present.filter((to) => to !== from).map((to) => direction(jev, segs.get(from)!, segs.get(to)!)),
    ),
  );

  const order = (d: Draft) => {
    const lang = present.find((l) => d.refs[l])!;
    const r = d.refs[lang]!;
    return [present.indexOf(lang), r.section, r.start];
  };
  const compared = jev.usage.inputTokens;
  const drafts = (await verifyFigures(jev, draftsFrom(directions))).sort((a, b) => {
    const [x, y] = [order(a), order(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  const subject = (segs.get("en") ?? segs.get(present[0])!).title;
  const verified = jev.usage.inputTokens;
  const scores = await importance(jev, drafts, segs, subject);
  const stages = {
    compare: compared,
    verifyFigures: verified - compared,
    importance: jev.usage.inputTokens - verified,
  };

  const claims: Claim[] = drafts.map((d, i) => ({
    id: `j${i}`,
    type: d.type,
    ...wording(d, present),
    spans: d.texts,
    refs: d.refs,
    confidence: Math.round(d.confidence * 100) / 100,
    importance: Math.round(scores[i] * 100) / 100,
    ...(d.wholeParagraph ? { group: d.wholeParagraph } : {}),
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
    `[jev] ${present.map((l) => `${l}:${segs.get(l)!.paragraphs.length}`).join(" ")} ${subject}: ` +
      `claims=${claims.length} ${JSON.stringify(counts)} requests=${jev.usage.requests} splits=${jev.usage.splits} ` +
      `tokens=${usage.inputTokens}in/${usage.outputTokens}out cost=$${usage.costUsd.toFixed(4)}`,
  );

  return {
    claims,
    alignment: alignmentOf(directions, segs),
    usage,
    spans: { offered: spanCount, matched: spanCount, droppedClaims: 0, samples: [] },
    scope: { kind: "full" },
    trace: directions.map((d) => d.trace),
    requests: jev.usage.requests,
    estimatedTokens: jev.usage.estimatedTokens,
    splits: jev.usage.splits,
    stages,
  };
}
