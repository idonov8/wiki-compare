import Anthropic from "@anthropic-ai/sdk";
import type {
  ArticleSnapshot,
  Claim,
  ComparisonScope,
  Lang,
  ScopeKind,
  Section,
  TokenCount,
  Usage,
} from "./types";
import { KEY_FACTS_HEADING, LANG_META, LEAD_HEADING, OUT_OF_CREDIT } from "./types";
import { PREVIEW_CHARS, previewOf, screenGroups, type SectionGroup } from "./deterministic";
import { costOfUsage, FALLBACK_PRICING_MODEL } from "./pricing";
import { ClaimStream } from "./stream-json";

export const PROMPT_VERSION = "v2";

const ALIGN_MODEL = process.env.ALIGN_MODEL || "claude-haiku-4-5-20251001";
// The default is FALLBACK_PRICING_MODEL rather than a second copy of the same
// string. The client prices rows that predate the per-model breakdown by
// assuming they ran on this model, so if the default here ever moves and that
// constant does not, every legacy row is silently priced at the wrong rate.
const DIFF_MODEL = process.env.DIFF_MODEL || FALLBACK_PRICING_MODEL;
const MAX_CHARS_PER_SECTION = 2500;
const GROUPS_PER_CALL = 3;

const client = () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function parseJson<T>(raw: string): T {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : raw).trim();
  const start = body.search(/[[{]/);
  return JSON.parse(start > 0 ? body.slice(start) : body) as T;
}

const ZERO_TOKENS = (): TokenCount => ({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 });

/**
 * Both books at once: the flat totals, and the same tokens filed under the model
 * that spent them.
 *
 * The totals used to be the only record, and they cannot be turned into money.
 * Alignment runs on Haiku at $1/$5 per Mtok and the diff on Sonnet at $3/$15, so
 * a single summed triple prices too high at one rate and too low at the other,
 * with no way to tell from the number itself which way it is wrong. The totals
 * stay because the log line and the stored rows already read them; `byModel` is
 * what `costOfUsage` actually bills from.
 */
function addUsage(total: Usage, message: Anthropic.Message, model: string): void {
  const input = message.usage.input_tokens;
  const output = message.usage.output_tokens;
  const cached = message.usage.cache_read_input_tokens ?? 0;

  total.inputTokens += input;
  total.outputTokens += output;
  total.cachedInputTokens += cached;

  const byModel = (total.byModel ??= {});
  const part = (byModel[model] ??= ZERO_TOKENS());
  part.inputTokens += input;
  part.outputTokens += output;
  part.cachedInputTokens += cached;
}

/**
 * Step one, cheap: match section headings across languages. Only the heading
 * strings go to the model, never the bodies, so this stays a few hundred tokens
 * regardless of how long the articles are.
 */
async function alignHeadings(articles: ArticleSnapshot[], usage: Usage): Promise<SectionGroup[]> {
  const leads: SectionGroup = { key: "lead", headings: {}, sections: {}, reasons: [], order: -2 };
  const keyFacts: SectionGroup = { key: "key-facts", headings: {}, sections: {}, reasons: [], order: -1 };
  const rest: Record<Lang, Section[]> = {} as Record<Lang, Section[]>;

  // The lead and the key-facts block are matched by their synthetic headings
  // rather than by position. Both are generated rather than lifted from the
  // article, so they align across languages without asking the model, and
  // neither belongs in the heading inventory it does have to read.
  for (const article of articles) {
    const others: Section[] = [];
    for (const section of article.sections) {
      const target =
        section.heading === LEAD_HEADING ? leads : section.heading === KEY_FACTS_HEADING ? keyFacts : null;
      if (target) {
        target.headings[article.lang] = section.heading;
        target.sections[article.lang] = section;
      } else {
        others.push(section);
      }
    }
    rest[article.lang] = others;
  }

  const inventory = articles
    .map((a) => `${a.lang}:\n${rest[a.lang].map((s, i) => `  ${i}. ${s.heading}`).join("\n") || "  (none)"}`)
    .join("\n\n");

  const message = await client().messages.create({
    model: ALIGN_MODEL,
    // Sized for the worst article, not the typical one. At 1500 a long article's
    // group list was cut off mid-JSON, the parse failed, and the run silently
    // compared only the lead and the infobox — a funded "full" read that read
    // almost nothing. Roughly 25 tokens per group, so this covers ~300 groups.
    max_tokens: 8000,
    system:
      "You match section headings of the same Wikipedia article written in different languages. " +
      "Headings are in the article's own language and rarely translate one-to-one. " +
      "Group headings that cover the same subject matter. A group may contain only one language. " +
      "Reply with JSON only, no prose, no code fences.",
    messages: [
      {
        role: "user",
        content:
          `Section headings by language:\n\n${inventory}\n\n` +
          `Return {"groups":[{"key":"short-english-slug","en":0,"he":2,"ar":1}, ...]} ` +
          `where each value is that language's section index. Omit a language key if it has no matching section.`,
      },
    ],
  });
  addUsage(usage, message, ALIGN_MODEL);

  // A truncated or unparseable group list must fail the run, not shrink it.
  // Falling back to an empty list meant everything below still "worked": the
  // diff ran on the lead and key facts alone, the result was stored as a full
  // comparison, and the reader who paid for the whole article got its top. An
  // error instead means the funded path refunds and nothing wrong is cached.
  if (message.stop_reason === "max_tokens") {
    throw new Error("Heading alignment was cut off before it finished; nothing was compared.");
  }
  let parsed: { groups?: Record<string, string | number>[] };
  try {
    parsed = parseJson(textOf(message));
  } catch {
    throw new Error("Heading alignment returned no usable groups; nothing was compared.");
  }

  const groups: SectionGroup[] = [leads, keyFacts].filter((g) => Object.keys(g.sections).length > 0);
  for (const raw of parsed.groups ?? []) {
    const key = String(raw.key ?? `group-${groups.length}`);
    // `order` starts at Infinity and is pulled down by each language that has
    // this section, so it ends up at the earliest appearance. The indices are
    // positions in `rest`, which drops the lead and the key-facts block, but
    // those two carry fixed negative orders and so still sort ahead of every
    // body group without any of this having to account for them.
    const group: SectionGroup = { key, headings: {}, sections: {}, reasons: [], order: Infinity };
    for (const article of articles) {
      const index = raw[article.lang];
      if (typeof index !== "number") continue;
      const section = rest[article.lang][index];
      if (!section) continue;
      group.headings[article.lang] = section.heading;
      group.sections[article.lang] = section;
      group.order = Math.min(group.order, index);
    }
    if (Object.keys(group.sections).length) groups.push(group);
  }
  return groups;
}

const DIFF_SYSTEM = `You compare Wikipedia articles on the same subject across languages and report where they disagree.

Report three kinds of difference:
- "contradiction": the versions state incompatible facts (different numbers, dates, names, outcomes).
- "unique": a substantive claim, event or actor that one version covers and another omits entirely.
- "framing": the versions describe the same fact but with materially different emphasis, attribution, terminology or implied stance. Terminology choices for contested places and events belong here.

Rules:
- Report only differences that would change a reader's understanding. Ignore stylistic variation, differences in detail level that carry no new claim, and anything already obvious from section length.
- For every difference, quote the relevant text VERBATIM from each version that carries it, character for character, copied exactly from the input including its own script and punctuation. Quote the shortest span that makes the point, at most about 25 words. Do not translate, paraphrase, normalise or re-type these spans: they are matched against the source by exact string search and a single altered character makes the difference undisplayable.
- Omit a language from "spans" when that version says nothing on the point.
- "summary" is at most 8 words. "explanation" is one or two sentences saying what each version claims and why the difference matters. Describe the versions neutrally; do not adjudicate which is correct unless one plainly contradicts the others on a checkable figure, in which case say so plainly.

Reply with JSON only, no prose, no code fences:
{"claims":[{"type":"contradiction","summary":"...","explanation":"...","spans":{"en":"...","he":"...","ar":"..."}}]}`;

const CLAIM_TYPES = ["contradiction", "unique", "framing"];

/** One parsed object from the model's array, as a `Claim` — or null if it is not
 *  shaped like one at all. An unrecognised `type` is framing rather than a drop:
 *  the difference was still found, and framing is the reading that claims least. */
function asClaim(raw: unknown, id: string): Claim | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<Claim>;
  if (typeof r.summary !== "string" || !r.summary) return null;
  return {
    id,
    type: CLAIM_TYPES.includes(r.type as string) ? (r.type as Claim["type"]) : "framing",
    summary: r.summary,
    explanation: typeof r.explanation === "string" ? r.explanation : "",
    spans: r.spans && typeof r.spans === "object" ? r.spans : {},
  };
}

/**
 * Run the diff and hand back every claim whose spans could be located.
 *
 * `deliver` is called with each claim the moment it is whole, which is what lets
 * the page fill in as the model writes rather than a minute later. It is not the
 * same thing as the return value: the return is in batch order and the callback
 * fires in completion order, so the stored comparison stays deterministic while
 * the reader still sees findings arrive as they are found.
 */
async function diffGroups(
  groups: SectionGroup[],
  langs: Lang[],
  usage: Usage,
  verify: (claim: Claim) => Claim | null,
  // A preview overrides both: its whole input is bounded by PREVIEW_CHARS per
  // language, so it goes in one call — the model sees the entire prefix at once
  // — and the per-section cap has to be the preview budget rather than a lower
  // number that would silently read less than the columns say was read.
  {
    perCall = GROUPS_PER_CALL,
    maxChars = MAX_CHARS_PER_SECTION,
    deliver,
  }: { perCall?: number; maxChars?: number; deliver?: (claim: Claim) => void } = {},
): Promise<{ claims: Claim[]; raw: number }> {
  const size = Math.max(1, perCall);
  const batches: SectionGroup[][] = [];
  for (let i = 0; i < groups.length; i += size) {
    batches.push(groups.slice(i, i + size));
  }

  const results = await Promise.all(
    batches.map(async (batch, batchIndex) => {
      const body = batch
        .map((group) => {
          const parts = langs
            .filter((l) => group.sections[l])
            .map(
              (l) =>
                `<${l} heading="${group.headings[l] ?? ""}">\n` +
                `${group.sections[l]!.text.slice(0, maxChars)}\n</${l}>`,
            )
            .join("\n\n");
          const note = group.reasons.length ? `\nAutomated pre-scan noted: ${group.reasons.join("; ")}.` : "";
          return `<section key="${group.key}">${note}\n\n${parts}\n</section>`;
        })
        .join("\n\n");

      // Claims are parsed out of the text as it arrives, so `id` is assigned on
      // completion order within the batch and prefixed by the batch — stable
      // across runs however the batches interleave, which the cached copy and
      // the client's React keys both depend on.
      const parser = new ClaimStream();
      const found: Claim[] = [];
      let raw = 0;

      const consume = (delta: string) => {
        for (const object of parser.push(delta)) {
          const claim = asClaim(object, `b${batchIndex}c${raw}`);
          raw++;
          if (!claim) continue;
          const located = verify(claim);
          if (!located) continue;
          found.push(located);
          deliver?.(located);
        }
      };

      const stream = client().messages.stream({
        model: DIFF_MODEL,
        max_tokens: 8000,
        // The breakpoint is correct but currently inert: the minimum cacheable
        // prefix is 1024 tokens on this model and DIFF_SYSTEM is roughly 400, so
        // nothing is written and `cachedInputTokens` stays at zero. Kept because
        // it starts paying the moment the prompt grows past the threshold, and
        // costs nothing meanwhile — but the comparison cache, not this, is what
        // makes a repeated article free.
        system: [{ type: "text", text: DIFF_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content:
              `Languages present: ${langs.map((l) => `${l} (${LANG_META[l].label})`).join(", ")}.\n\n${body}`,
          },
        ],
      });

      stream.on("text", consume);
      const message = await stream.finalMessage();
      addUsage(usage, message, DIFF_MODEL);

      const label = batch.map((g) => g.key).join(", ");

      // Truncation used to cost the whole batch: the response was unparseable
      // JSON and the catch discarded every claim in it. Parsing as it streams
      // means only the claim being written when the budget ran out is lost, but
      // the rest of the batch's sections went unread, so it still needs saying.
      if (message.stop_reason === "max_tokens") {
        console.warn(
          `[compare] batch [${label}] hit max_tokens after ${raw} claim(s); ` +
            `the rest are lost. Raise max_tokens or lower GROUPS_PER_CALL.`,
        );
      }

      const text = textOf(message);
      if (raw === 0 && text.trim() && !/"claims"\s*:\s*\[\s*\]/.test(text)) {
        console.warn(
          `[compare] batch [${label}] yielded no parseable claim from ${text.length} chars of output.`,
        );
      }

      return { claims: found, raw };
    }),
  );

  return {
    claims: results.flatMap((r) => r.claims),
    raw: results.reduce((n, r) => n + r.raw, 0),
  };
}

export interface SpanReport {
  /** Spans the model returned, across all claims. */
  offered: number;
  /** Spans found character-for-character in the source. */
  matched: number;
  /** Claims dropped entirely because not one of their spans could be located. */
  droppedClaims: number;
  /** A few misses, for diagnosing whether the prompt or the matcher is at fault. */
  samples: { lang: Lang; snippet: string }[];
}

/**
 * Drop claims whose spans can't be found in the source, since the UI has
 * nothing to highlight for them.
 *
 * The comparison is exact and deliberately stays that way. A span that needs
 * normalising or trimming to match is a span the model paraphrased, and
 * highlighting paraphrased text at the closest lexical position is worse than
 * not highlighting it — it silently attributes a claim to a sentence that does
 * not make it. If the drop rate is high the prompt is what needs tightening;
 * `report` exists so that is measurable rather than guessed at.
 *
 * Each section is searched separately rather than against the concatenated
 * article, because that is what the renderer does. Verifying against the join
 * would admit spans that straddle a section boundary, which then match nothing
 * at render time and silently disappear.
 */
function spanVerifier(articles: ArticleSnapshot[]): {
  report: SpanReport;
  verify: (claim: Claim) => Claim | null;
} {
  const haystacks = new Map<Lang, string[]>(
    articles.map((a) => [a.lang, a.sections.map((s) => s.text)]),
  );

  const report: SpanReport = { offered: 0, matched: 0, droppedClaims: 0, samples: [] };

  // One claim at a time rather than an array, because a streamed claim has to be
  // judged the moment it completes: it is either locatable and shippable now, or
  // it never becomes locatable by waiting for the claims after it.
  const verify = (claim: Claim): Claim | null => {
    const spans: Claim["spans"] = {};
    for (const [lang, snippet] of Object.entries(claim.spans) as [Lang, string][]) {
      if (!snippet) continue;
      report.offered++;
      if (haystacks.get(lang)?.some((text) => text.includes(snippet))) {
        report.matched++;
        spans[lang] = snippet;
      } else if (report.samples.length < 8) {
        report.samples.push({ lang, snippet: snippet.slice(0, 120) });
      }
    }
    if (!Object.keys(spans).length) {
      report.droppedClaims++;
      return null;
    }
    return { ...claim, spans };
  };

  return { report, verify };
}

/**
 * `onClaim` fires as each difference is found and verified, before the run is
 * over. Optional: without it this is exactly the batch call it always was, which
 * is what the funded path and the fixture recorder still want.
 */
export async function runComparison(
  articles: ArticleSnapshot[],
  scope: ScopeKind = "full",
  onClaim?: (claim: Claim) => void,
): Promise<{ claims: Claim[]; usage: Usage; spans: SpanReport; scope: ComparisonScope }> {
  try {
    return await compare(articles, scope, onClaim);
  } catch (error) {
    if (!isOutOfCredit(error)) throw error;
    console.error("[compare] the Anthropic account is out of credit; no article can be read.");
    throw new Error(OUT_OF_CREDIT);
  }
}

/**
 * The site's own balance, not the reader's.
 *
 * The SDK puts the API's JSON body in `message`, so the sentence Anthropic
 * sends is what there is to match on. Matched on the prose rather than on the
 * status: 400 is also what a malformed request gets, and the two want opposite
 * things said to the reader.
 */
export function isOutOfCredit(error: unknown): boolean {
  return error instanceof Error && /credit balance is too low/i.test(error.message);
}

async function compare(
  articles: ArticleSnapshot[],
  scope: ScopeKind,
  onClaim?: (claim: Claim) => void,
): Promise<{ claims: Claim[]; usage: Usage; spans: SpanReport; scope: ComparisonScope }> {
  const usage: Usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  const langs = articles.map((a) => a.lang);

  // A preview compares the same first PREVIEW_CHARS characters of every version
  // against each other, so it is run against truncated copies of the snapshots
  // and everything downstream is the ordinary path. A full run reads whatever
  // diverges most; see `previewOf` for why the two cannot be one selection with
  // different limits.
  const previews = scope === "preview" ? articles.map((a) => previewOf(a)) : null;
  const read = previews ? previews.map((p) => p.article) : articles;

  const groups = await alignHeadings(read, usage);
  const selected = previews
    ? // Everything the prefix contains, in document order: it is already the
      // budget, so there is nothing left for screening to decide.
      [...groups].sort((a, b) => a.order - b.order)
    : screenGroups(groups, langs);
  // Verified against the full articles, not the truncated copies: a span quoted
  // out of a prefix is a substring of the section the columns actually render,
  // which is what the highlighter has to find it in.
  const { report, verify } = spanVerifier(articles);
  const { claims, raw } = await diffGroups(selected, langs, usage, verify, {
    ...(previews ? { perCall: selected.length, maxChars: PREVIEW_CHARS } : {}),
    deliver: onClaim,
  });

  // Priced here, once, while the model ids that spent the tokens are still in
  // hand. The figure is stored with the comparison and never recomputed, so a
  // rate change tomorrow does not rewrite what a run cost today.
  usage.costUsd = costOfUsage(usage, DIFF_MODEL);

  const pct = report.offered ? Math.round((report.matched / report.offered) * 100) : 100;
  console.log(
    `[compare] scope=${scope} groups=${selected.length}/${groups.length} (${selected.map((g) => g.key).join(", ")}) ` +
      `claims=${raw}->${claims.length} spans=${report.matched}/${report.offered} (${pct}% matched) ` +
      `tokens=${usage.inputTokens}in/${usage.outputTokens}out/${usage.cachedInputTokens}cached ` +
      `cost=$${usage.costUsd.toFixed(4)}`,
  );
  if (previews) {
    // The point of the character budget is that these three numbers are within
    // a line of each other whatever the articles look like, so print them.
    const depth = ({ article }: { article: ArticleSnapshot }) =>
      article.sections
        .filter((s) => s.heading !== KEY_FACTS_HEADING)
        .reduce((n, s) => n + s.text.length, 0);
    console.log(
      `[compare]   preview budget ${PREVIEW_CHARS}: ` +
        previews.map((p) => `${p.article.lang}=${depth(p)}`).join(" "),
    );
  }
  for (const miss of report.samples) {
    console.log(`[compare]   unmatched ${miss.lang}: ${JSON.stringify(miss.snippet)}`);
  }

  return {
    claims,
    usage,
    spans: report,
    scope: previews
      ? {
          kind: "preview",
          processedThrough: Object.fromEntries(previews.map((p) => [p.article.lang, p.cut])),
        }
      : { kind: "full" },
  };
}
