import {
  TypeSafeClient,
  choice,
  score,
  type Description,
  type EntryType,
  type Questions,
  type SystemOneResult,
} from "@typesafe-ai/sdk";

export const JEV_MODEL = process.env.JEV_MODEL || "jev-latest";

const CONCURRENCY = Number(process.env.JEV_CONCURRENCY) || 24;
/** The model takes 64k tokens per request, and 32k for the state plus the
 *  longest question. The budgets leave room because the estimate is a character
 *  ratio, not Jev's tokenizer; a request that is too big anyway is split. */
const REQUEST_BUDGET = 40_000;
export const QUESTION_BUDGET = 24_000;
const MAX_QUESTIONS = 32;

/** Latin text at about 3.5 characters a token, and Hebrew or Arabic at one a
 *  character. TypeSafe does not publish its tokenizer, and the first real runs
 *  overflowed an estimate of two Hebrew characters a token. */
export function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let ascii = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 128) ascii++;
  return Math.ceil(ascii / 3.5 + (text.length - ascii));
}

/** One question, with its state, is more than the model takes. The caller has
 *  to send less state, which only it knows how to do. Recognised by name rather
 *  than `instanceof`, since a script and the library can each load their own
 *  copy of this module. */
export class JevTooLarge extends Error {
  name = "JevTooLarge";
}

export const isTooLarge = (error: unknown) => error instanceof Error && error.name === "JevTooLarge";

/** Checked by shape, not `instanceof APIError`: the SDK ships separate ESM and
 *  CommonJS builds, and an error thrown by one is not an instance of the other's
 *  class. */
const tooLarge = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  (error as { status?: unknown }).status === 400 &&
  JSON.stringify((error as { body?: unknown }).body ?? "").includes("max_tokens_exceeded");

export interface Ask {
  id: string;
  instructions: string;
  options: [label: string, description: Description][];
}

/** A Score question: an ordered rubric, lowest first. */
export interface Rate {
  id: string;
  instructions: string;
  rubric: [string, string, ...string[]];
}

export interface Rating {
  /** The expected level, so it can fall between two rubric levels. */
  score: number;
  confidence: number;
}

export interface Answer {
  choice: string;
  confidence: number;
  /** Averaged over both option orders. */
  probabilities: Record<string, number>;
  /** Whether the forward and reversed orderings picked the same label. */
  orderAgreed: boolean;
}

function semaphore(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

const criteria = (options: Ask["options"]) => Object.fromEntries(options);

/**
 * Every Choice is asked twice in the same request, once with its options in
 * order and once reversed, and the two distributions are averaged.
 *
 * jev-1.13 leans toward whichever option comes first. Averaging the two orders
 * cancels that lean instead of choosing which way to be wrong, and whether the
 * two orders agreed is a free signal of how settled the answer is.
 */
export class Jev {
  /** `estimatedTokens` is what the planner thought the same requests would cost,
   *  so a run reports how far off the estimate is. */
  readonly usage = { inputTokens: 0, outputTokens: 0, requests: 0, estimatedTokens: 0, splits: 0 };
  model = JEV_MODEL;
  /** The largest actual-to-estimated ratio seen so far, applied to every later
   *  plan, so real responses correct the estimate for the rest of the run, in
   *  either direction. Splitting covers a plan that comes out too big anyway. */
  private scale = 1;
  private observed = 0;
  private readonly client: TypeSafeClient;
  private readonly limit = semaphore(CONCURRENCY);

  constructor(client?: TypeSafeClient) {
    this.client =
      client ?? new TypeSafeClient({ defaultModel: JEV_MODEL, timeout: 30_000, retry: { maxRetries: 4 } });
  }

  estimate(value: unknown): number {
    return Math.ceil(estimateTokens(value) * this.scale);
  }

  async choices(state: EntryType, asks: Ask[]): Promise<Map<string, Answer>> {
    const answers = new Map<string, Answer>();
    await this.send(
      state,
      asks.map((ask) => ({
        id: ask.id,
        questions: {
          [`${ask.id}.f`]: choice(ask.instructions, criteria(ask.options)),
          [`${ask.id}.r`]: choice(ask.instructions, criteria([...ask.options].reverse())),
        },
      })),
      (id, result) => {
        const ask = asks.find((a) => a.id === id)!;
        const f = result.answers[`${id}.f`];
        const r = result.answers[`${id}.r`];
        if (f?.type !== "choice" || r?.type !== "choice") return;
        const probabilities: Record<string, number> = {};
        for (const [label] of ask.options) {
          probabilities[label] = ((f.probabilities[label] ?? 0) + (r.probabilities[label] ?? 0)) / 2;
        }
        const [best, p] = Object.entries(probabilities).reduce((a, b) => (b[1] > a[1] ? b : a));
        answers.set(id, { choice: best, confidence: p, probabilities, orderAgreed: f.choice === r.choice });
      },
    );
    return answers;
  }

  /** Score questions, asked once: a rubric is an order, and reversing it would
   *  be a different question rather than the same one shuffled. */
  async scores(state: EntryType, rates: Rate[]): Promise<Map<string, Rating>> {
    const ratings = new Map<string, Rating>();
    await this.send(
      state,
      rates.map((rate) => ({ id: rate.id, questions: { [rate.id]: score(rate.instructions, rate.rubric) } })),
      (id, result) => {
        const answer = result.answers[id];
        if (answer?.type === "score") ratings.set(id, { score: answer.score, confidence: answer.confidence });
      },
    );
    return ratings;
  }

  private async send(
    state: EntryType,
    items: { id: string; questions: Questions }[],
    read: (id: string, result: SystemOneResult<Questions>) => void,
  ): Promise<void> {
    const stateTokens = this.estimate(state);
    const batches: (typeof items)[] = [];
    let batch: typeof items = [];
    let tokens = stateTokens;
    let count = 0;
    for (const item of items) {
      const questions = Object.values(item.questions);
      const longest = Math.max(...questions.map((q) => this.estimate(q)));
      const cost = questions.reduce((n, q) => n + this.estimate(q), 0);
      if (stateTokens + longest > QUESTION_BUDGET) {
        throw new JevTooLarge(`Jev question ${item.id} is too large (~${stateTokens + longest} tokens with its state).`);
      }
      if (batch.length && (tokens + cost > REQUEST_BUDGET || count + questions.length > MAX_QUESTIONS)) {
        batches.push(batch);
        batch = [];
        tokens = stateTokens;
        count = 0;
      }
      batch.push(item);
      tokens += cost;
      count += questions.length;
    }
    if (batch.length) batches.push(batch);
    await Promise.all(batches.map((group) => this.limit(() => this.ask(state, group, read))));
  }

  /** One request, halved and retried when Jev says it is over its limit. */
  private async ask(
    state: EntryType,
    group: { id: string; questions: Questions }[],
    read: (id: string, result: SystemOneResult<Questions>) => void,
  ): Promise<void> {
    const questions: Questions = Object.assign({}, ...group.map((item) => item.questions));

    let result: SystemOneResult<Questions>;
    try {
      result = await this.client.systemOne({ state, questions });
    } catch (error) {
      if (!tooLarge(error)) throw error;
      if (group.length === 1) throw new JevTooLarge(`Jev question ${group[0].id} is over the model's limit.`);
      this.usage.splits++;
      const half = Math.ceil(group.length / 2);
      await this.ask(state, group.slice(0, half), read);
      await this.ask(state, group.slice(half), read);
      return;
    }

    const estimated = estimateTokens({ state, questions });
    this.usage.inputTokens += result.usage.input_tokens;
    this.usage.outputTokens += result.usage.output_tokens;
    this.usage.estimatedTokens += estimated;
    this.usage.requests++;
    this.model = result.model || this.model;
    if (estimated > 0 && result.usage.input_tokens > 0) {
      this.observed = Math.max(this.observed, result.usage.input_tokens / estimated);
      this.scale = Math.min(3, Math.max(0.5, this.observed));
    }
    for (const item of group) read(item.id, result);
  }
}
