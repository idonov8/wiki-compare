import { LANG_META } from "../types";
import { QUESTION_BUDGET, estimateTokens, type Answer, type Ask, type Jev } from "./client";
import type { Paragraph, Segmented, Unit } from "./segment";

export interface Candidate {
  paragraph: Paragraph;
  p: number;
}

export interface Match {
  /** Probability that nothing in the other article covers this unit. */
  none: number;
  /** Paragraphs worth classifying against, most likely first. */
  candidates: Candidate[];
  answer: Answer;
}

/** A pool bigger than this, or with more paragraphs than a Choice takes, is
 *  split into chunks for a tournament. */
const CHUNK_BUDGET = 14_000;
const MAX_OPTIONS = 250;
/** How many paragraphs each chunk sends on to the final round. */
const FINALISTS_PER_CHUNK = 2;
const CANDIDATE_FLOOR = 0.15;
const MAX_CANDIDATES = 3;

const labelled = (p: Unit) => `[${p.heading}] ${p.text}`;
const tagged = (pool: Paragraph[]) => pool.map((p, i) => `b${i}| ${labelled(p)}`).join("\n\n");

interface Context {
  jev: Jev;
  fromName: string;
  toName: string;
  task: string;
}

/**
 * One Choice per unit over `pool` plus "none", with the probabilities keyed by
 * index into `pool`.
 *
 * In the usual layout the paragraphs are an ID-tagged document in the state and
 * the options are bare IDs, which is how TypeSafe's own search cookbook lays it
 * out: the text is sent once per request rather than once per question. The
 * final round of a tournament has a different shortlist per unit, so there the
 * options carry their text instead.
 */
async function round(
  ctx: Context,
  units: (Unit & { id: string })[],
  poolFor: (unit: Unit & { id: string }) => Paragraph[],
  layout: "ids" | "inline",
): Promise<Map<string, { none: number; ranked: Candidate[]; answer: Answer }>> {
  const state = {
    task: ctx.task,
    ...(layout === "ids" ? { [`${ctx.toName.toLowerCase()}_article`]: tagged(poolFor(units[0])) } : {}),
  };
  const asks: Ask[] = units.map((unit) => ({
    id: unit.id,
    instructions:
      `Which paragraph of the ${ctx.toName} article covers the same information or events as this passage from the ${ctx.fromName} article?\n\n` +
      `Passage: ${labelled(unit)}`,
    options: [
      ["none", `No paragraph of the ${ctx.toName} article covers this information`],
      ...poolFor(unit).map((p, i): [string, string | null] => [`b${i}`, layout === "ids" ? null : labelled(p)]),
    ],
  }));

  const answers = await ctx.jev.choices(state, asks);
  const out = new Map<string, { none: number; ranked: Candidate[]; answer: Answer }>();
  for (const unit of units) {
    const answer = answers.get(unit.id);
    if (!answer) continue;
    const ranked = poolFor(unit)
      .map((paragraph, i) => ({ paragraph, p: answer.probabilities[`b${i}`] ?? 0 }))
      .sort((a, b) => b.p - a.p);
    out.set(unit.id, { none: answer.probabilities.none ?? 0, ranked, answer });
  }
  return out;
}

function chunks(pool: Paragraph[]): Paragraph[][] {
  const out: Paragraph[][] = [];
  let current: Paragraph[] = [];
  let tokens = 0;
  for (const p of pool) {
    const cost = estimateTokens(labelled(p));
    if (current.length && (tokens + cost > CHUNK_BUDGET || current.length >= MAX_OPTIONS)) {
      out.push(current);
      current = [];
      tokens = 0;
    }
    current.push(p);
    tokens += cost;
  }
  if (current.length) out.push(current);
  return out;
}

/**
 * For each unit of `from`, which paragraph of `to` covers the same ground.
 *
 * More than the top answer is kept: one paragraph in English often covers what
 * Hebrew splits over two, and the lead restates what the body says elsewhere.
 *
 * A pool too big for one question is run as a tournament, in the level-by-level
 * way TypeSafe recommends for large option sets: each chunk of the pool
 * nominates its likeliest paragraphs, and a final round chooses among the
 * nominees with their full text. "none" is decided in the final round only,
 * since a chunk saying "not here" says nothing about the rest of the article.
 */
export async function matchUnits(
  jev: Jev,
  from: Segmented,
  to: Segmented,
  units: (Unit & { id: string })[],
  pool: Paragraph[],
): Promise<Map<string, Match>> {
  const out = new Map<string, Match>();
  if (!units.length) return out;

  const ctx: Context = {
    jev,
    fromName: LANG_META[from.lang].label,
    toName: LANG_META[to.lang].label,
    task: `Find where a passage of the ${LANG_META[from.lang].label} Wikipedia article "${from.title}" is covered in the ${LANG_META[to.lang].label} Wikipedia article "${to.title}" on the same subject.`,
  };

  const longestUnit = Math.max(...units.map((u) => estimateTokens(labelled(u))));
  const fits =
    pool.length <= MAX_OPTIONS && estimateTokens(tagged(pool)) + longestUnit + pool.length * 4 < QUESTION_BUDGET - 1_000;

  let final: Awaited<ReturnType<typeof round>>;
  if (fits) {
    final = await round(ctx, units, () => pool, "ids");
  } else {
    const heats = await Promise.all(chunks(pool).map((chunk) => round(ctx, units, () => chunk, "ids")));
    const finalists = new Map(
      units.map((u) => [
        u.id,
        heats.flatMap((heat) => heat.get(u.id)?.ranked.slice(0, FINALISTS_PER_CHUNK).map((c) => c.paragraph) ?? []),
      ]),
    );
    final = await round(ctx, units, (u) => finalists.get(u.id) ?? [], "inline");
  }

  for (const unit of units) {
    const result = final.get(unit.id);
    if (!result) continue;
    const kept = result.ranked.filter((c) => c.p >= CANDIDATE_FLOOR).slice(0, MAX_CANDIDATES);
    out.set(unit.id, {
      none: result.none,
      candidates: kept.length ? kept : result.ranked.slice(0, 1),
      answer: result.answer,
    });
  }
  return out;
}
