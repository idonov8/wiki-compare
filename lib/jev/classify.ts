import { LANG_META } from "../types";
import type { Answer, Ask, Jev } from "./client";
import type { Paragraph, Segmented, Unit } from "./segment";

export const VERDICTS = ["consistent", "contradiction", "framing", "gap"] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface SentenceVerdict {
  sentence: Unit;
  verdict: Verdict;
  confidence: number;
  answer: Answer;
  /** The sentence of the other article this one corresponds to, when Jev could
   *  point at one. It is what puts a contradiction's mark on both columns. */
  counterpart?: { unit: Unit; p: number };
  against: Paragraph[];
}

const labelled = (p: Unit) => `[${p.heading}] ${p.text}`;
const paragraphOf = (u: Unit, s: Segmented) =>
  s.paragraphs.find((p) => p.section === u.section && p.start <= u.start && p.end >= u.end);

/**
 * Each sentence of a paragraph against the paragraph(s) it was matched to.
 *
 * Two questions per sentence, in the same request: what kind of relation it has
 * to the other passage, and which sentence of the other passage carries it.
 */
export async function classifySentences(
  jev: Jev,
  from: Segmented,
  to: Segmented,
  sentences: Unit[],
  against: Paragraph[],
  keyPrefix: string,
): Promise<SentenceVerdict[]> {
  if (!sentences.length || !against.length) return [];
  const fromName = LANG_META[from.lang].label;
  const toName = LANG_META[to.lang].label;
  const targets = against.flatMap((p) => p.sentences);
  const source = paragraphOf(sentences[0], from);

  // The other passage rides in the state once, as ID-tagged sentences, so the
  // pair question's options are bare IDs rather than every sentence repeated in
  // every question.
  const state = {
    task: `Compare information in the ${fromName} and ${toName} Wikipedia articles on the same subject.`,
    [`${fromName.toLowerCase()}_passage`]: source ? labelled(source) : sentences.map((s) => s.text).join(" "),
    [`${toName.toLowerCase()}_headings`]: [...new Set(against.map((p) => p.heading))],
    [`${toName.toLowerCase()}_passage`]: targets.map((t, i) => `s${i}| ${t.text}`).join("\n"),
  };

  const relation: Ask["options"] = [
    [
      "consistent",
      {
        what: `The ${toName} passage states the same information, possibly in other words, in more or less detail, or inside a longer statement`,
        not_for: "Information where a number, date, name or outcome differs",
      },
    ],
    [
      "contradiction",
      {
        what: `The ${toName} passage states incompatible information about the same thing: a different number, date, name, place or outcome`,
      },
    ],
    [
      "framing",
      {
        what: `The ${toName} passage reports the same fact but with notably different terminology, attribution or emphasis that implies a different stance`,
        examples: ["'West Bank' versus 'Judea and Samaria'", "'killed' versus 'martyred'", "'captured' versus 'liberated'"],
      },
    ],
    ["gap", { what: `The ${toName} passage does not mention the information in this sentence at all` }],
  ];

  const pairOptions: Ask["options"] = [
    ["none", `No sentence of the ${toName} passage carries this information`],
    ...targets.map((_, i): [string, null] => [`s${i}`, null]),
  ];

  const asks: Ask[] = sentences.flatMap((s, i) => [
    {
      id: `${keyPrefix}.${i}.type`,
      instructions: `How does the ${toName} passage relate to this sentence from the ${fromName} article?\n\nSentence: ${s.text}`,
      options: relation,
    },
    {
      id: `${keyPrefix}.${i}.pair`,
      instructions: `Which sentence of the ${toName} passage carries the information of this ${fromName} sentence?\n\nSentence: ${s.text}`,
      options: pairOptions,
    },
  ]);

  const answers = await jev.choices(state, asks);
  const out: SentenceVerdict[] = [];
  sentences.forEach((sentence, i) => {
    const type = answers.get(`${keyPrefix}.${i}.type`);
    if (!type) return;
    const pair = answers.get(`${keyPrefix}.${i}.pair`);
    const index = pair && pair.choice !== "none" ? Number(pair.choice.slice(1)) : -1;
    out.push({
      sentence,
      verdict: type.choice as Verdict,
      confidence: type.confidence,
      answer: type,
      counterpart: index >= 0 && targets[index] ? { unit: targets[index], p: pair!.confidence } : undefined,
      against,
    });
  });
  return out;
}
