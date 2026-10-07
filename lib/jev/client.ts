import { TypeSafeClient, choice, type Description, type EntryType, type Questions } from "@typesafe-ai/sdk";

export const JEV_MODEL = process.env.JEV_MODEL || "jev-latest";

const CONCURRENCY = Number(process.env.JEV_CONCURRENCY) || 12;
/** The model takes 64k tokens per request, and 32k for the state plus the
 *  longest question. Both budgets stay under the limits because the estimate is
 *  a character ratio, not a tokenizer. */
const REQUEST_BUDGET = 48_000;
export const QUESTION_BUDGET = 28_000;
const MAX_QUESTIONS = 48;

/** An overestimate on purpose: Latin text at about 3.5 characters a token, and
 *  Hebrew or Arabic at 2, denser than most tokenizers actually cut them. */
export function estimateTokens(value: unknown): number {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let ascii = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) < 128) ascii++;
  return Math.ceil(ascii / 3.5 + (text.length - ascii) / 2);
}

export interface Ask {
  id: string;
  instructions: string;
  options: [label: string, description: Description][];
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
  readonly usage = { inputTokens: 0, outputTokens: 0, requests: 0 };
  model = JEV_MODEL;
  private readonly client: TypeSafeClient;
  private readonly limit = semaphore(CONCURRENCY);

  constructor(client?: TypeSafeClient) {
    this.client =
      client ?? new TypeSafeClient({ defaultModel: JEV_MODEL, timeout: 30_000, retry: { maxRetries: 4 } });
  }

  async choices(state: EntryType, asks: Ask[]): Promise<Map<string, Answer>> {
    const stateTokens = estimateTokens(state);
    const batches: Ask[][] = [];
    let batch: Ask[] = [];
    let tokens = stateTokens;
    for (const ask of asks) {
      const cost = estimateTokens(ask.instructions) + estimateTokens(ask.options);
      if (stateTokens + cost > QUESTION_BUDGET) {
        throw new Error(`Jev question ${ask.id} is too large (~${stateTokens + cost} tokens with its state).`);
      }
      if (batch.length && (tokens + 2 * cost > REQUEST_BUDGET || 2 * (batch.length + 1) > MAX_QUESTIONS)) {
        batches.push(batch);
        batch = [];
        tokens = stateTokens;
      }
      batch.push(ask);
      tokens += 2 * cost;
    }
    if (batch.length) batches.push(batch);

    const answers = new Map<string, Answer>();
    await Promise.all(
      batches.map((group) =>
        this.limit(async () => {
          const questions: Questions = {};
          for (const ask of group) {
            questions[`${ask.id}.f`] = choice(ask.instructions, criteria(ask.options));
            questions[`${ask.id}.r`] = choice(ask.instructions, criteria([...ask.options].reverse()));
          }
          const result = await this.client.systemOne({ state, questions });
          this.usage.inputTokens += result.usage.input_tokens;
          this.usage.outputTokens += result.usage.output_tokens;
          this.usage.requests++;
          this.model = result.model || this.model;

          for (const ask of group) {
            const f = result.answers[`${ask.id}.f`];
            const r = result.answers[`${ask.id}.r`];
            if (f?.type !== "choice" || r?.type !== "choice") continue;
            const probabilities: Record<string, number> = {};
            for (const [label] of ask.options) {
              probabilities[label] = ((f.probabilities[label] ?? 0) + (r.probabilities[label] ?? 0)) / 2;
            }
            const [best, p] = Object.entries(probabilities).reduce((a, b) => (b[1] > a[1] ? b : a));
            answers.set(ask.id, { choice: best, confidence: p, probabilities, orderAgreed: f.choice === r.choice });
          }
        }),
      ),
    );
    return answers;
  }
}
