import Anthropic from "@anthropic-ai/sdk";
import type { AlignedSentence, Claim, ComparisonResult, Lang, TextRef } from "./types";
import { LANG_META } from "./types";

export const EXPLAIN_MODEL = process.env.EXPLAIN_MODEL || "claude-sonnet-5-5";

const SYSTEM = `You explain one difference that an automated comparison found between language editions of the same Wikipedia article.

Write two or three plain sentences in English for a general reader. Say what each version says, translating any Hebrew or Arabic you refer to, and why the difference matters for understanding the subject.

If the finding looks mistaken (the versions actually agree, or the other version does cover the point), say so plainly instead of explaining a difference that is not there.

Stay neutral. On contested questions, describe each version's wording and what it implies without taking a side.

No preamble, headings or lists.`;

const KIND: Record<Claim["type"], string> = {
  contradiction: "The versions state incompatible facts",
  framing: "The versions report the same fact but describe it differently",
  unique: "One version has information the others lack",
};

const same = (a: TextRef, b: TextRef) => a.section === b.section && a.start === b.start;

function passage(result: ComparisonResult, lang: Lang, ref: TextRef): string {
  const section = result.articles[lang]?.sections[ref.section];
  if (!section) return "";
  return `[${section.heading}] ${section.text.slice(ref.start, ref.end)}`;
}

/** Where the claim's sentence sits, with its paragraph and its counterparts. */
function rowOf(result: ComparisonResult, lang: Lang, ref: TextRef): AlignedSentence | undefined {
  return result.alignment?.[lang]?.find((row) => same(row, ref));
}

/**
 * The prompt for one claim: the finding, each flagged sentence inside its
 * paragraph, and for a gap what each lacking version has nearest to it, so the
 * model can see for itself whether the gap is real.
 */
export function explanationPrompt(result: ComparisonResult, claim: Claim): string {
  const english = result.articles.en?.title;
  const anyTitle = Object.values(result.articles)[0]?.title;
  const lines = [`Subject: ${english ?? anyTitle}`, `Finding: ${KIND[claim.type]}. ${claim.summary}.`];

  for (const [lang, ref] of Object.entries(claim.refs ?? {}) as [Lang, TextRef][]) {
    const row = rowOf(result, lang, ref);
    const name = LANG_META[lang].label;
    lines.push("", `${name} sentence: ${claim.spans[lang]}`);
    if (row) lines.push(`${name} paragraph it belongs to: ${passage(result, lang, row.paragraph)}`);

    if (claim.type === "unique") {
      for (const missing of claim.missingFrom ?? []) {
        const counterpart = row?.to[missing];
        const other = LANG_META[missing].label;
        lines.push(
          counterpart
            ? `Closest ${other} passage, which the comparison judged not to contain it: ${passage(result, missing, counterpart.paragraph)}`
            : `No paragraph of the ${other} article was matched to this.`,
        );
      }
    }
  }
  return lines.join("\n");
}

const client = () => new Anthropic();

/**
 * Stream an explanation, calling `onText` with each piece as it arrives, and
 * resolve with the whole text and the usage once it is done.
 *
 * Thinking is left to the model and effort kept low: this answers a hover, and
 * two or three sentences need speed more than depth. Server-side fallbacks are on
 * so a safety decline on a contested subject is retried on another model rather
 * than leaving the reader with nothing.
 */
export async function streamExplanation(
  result: ComparisonResult,
  claim: Claim,
  onText: (text: string) => void,
): Promise<{ text: string; model: string; usage: unknown }> {
  const stream = client().beta.messages.stream({
    model: EXPLAIN_MODEL,
    max_tokens: 1024,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: SYSTEM,
    messages: [{ role: "user", content: explanationPrompt(result, claim) }],
  });
  stream.on("text", onText);
  const message = await stream.finalMessage();
  const text = message.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
  if (message.stop_reason === "refusal" || !text) {
    throw new Error("No explanation could be generated for this difference.");
  }
  return { text, model: message.model, usage: message.usage };
}
