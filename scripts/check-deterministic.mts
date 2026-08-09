/**
 * Assertions over the zero-token pass: coverage diffing, digit normalisation and
 * section screening. No network, no model, no database.
 *
 *   npm run check:deterministic
 */
import {
  PREVIEW_CHARS,
  coverageGaps,
  extractNumbers,
  normaliseDigits,
  previewOf,
  screenGroups,
  type SectionGroup,
} from "../lib/deterministic";
import { articlesFor, costOfUsage, formatCost, ratesFor } from "../lib/pricing";
import { KEY_FACTS_HEADING, LEAD_HEADING, type ArticleSnapshot, type Lang, type Section, type Usage } from "../lib/types";
import { fixtureLabels, fixtureSnapshots, listFixtures, loadFixture } from "../fixtures/loader";

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (ok) console.log(`    ok    ${label}`);
  else {
    failures++;
    console.log(`    FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
};

// ---- coverage ---------------------------------------------------------------

const CALENDAR = /^\s*(?:\d{1,4}\s*(?:[–—-]\s*\d{1,4}\s*)?|(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December))\s*$/i;
const METADATA = /^(Virtual International Authority File|WorldCat|Integrated Authority File|ISNI|VIAF)$/i;

for (const slug of listFixtures()) {
  const fixture = loadFixture(slug);
  const snaps = fixtureSnapshots(fixture);
  const gaps = coverageGaps(snaps, fixtureLabels(fixture));
  console.log(`\n${fixture.query}: ${gaps.length} coverage gaps`);

  check(gaps.length > 0, "produces gaps");
  check(!gaps.some((g) => CALENDAR.test(g.label)), "no calendar labels",
    gaps.filter((g) => CALENDAR.test(g.label)).map((g) => g.label).join(", "));
  check(!gaps.some((g) => METADATA.test(g.label)), "no authority-control labels",
    gaps.filter((g) => METADATA.test(g.label)).map((g) => g.label).join(", "));
  check(gaps.every((g) => g.presentIn.length > 0 && g.missingFrom.length > 0), "every gap is genuinely lopsided");
  console.log(`      top 5: ${gaps.slice(0, 5).map((g) => `${g.label} (${g.presentIn.join("+")})`).join(" · ")}`);
}

// ---- digits -----------------------------------------------------------------

console.log("\nArabic-Indic digit normalisation");
check(normaliseDigits("١٣٢") === "132", "Arabic-Indic ١٣٢ -> 132");
check(normaliseDigits("٧٤") === "74", "Arabic-Indic ٧٤ -> 74");
check(normaliseDigits("۴۵") === "45", "Extended (Farsi) ۴۵ -> 45");
check(normaliseDigits("من ١٣٢ عضوا") === "من 132 عضوا", "normalises inside Arabic text");
{
  const nums = extractNumbers("يتألف المجلس التشريعي من ١٣٢ عضوا، وفاز ٧٤ مقعدا");
  check(nums.has("132") && nums.has("74"), "extractNumbers folds Arabic-Indic to ASCII", [...nums].join(","));
  const mixed = extractNumbers("132 و ١٣٢");
  check(mixed.size === 1, "same value in both scripts compares equal", [...mixed].join(","));
}

// The recorded Arabic article writes its numerals in ASCII, so this path is
// correct but unexercised by the fixtures — assert that explicitly rather than
// let a passing suite imply coverage it does not have.
{
  const ar = fixtureSnapshots(loadFixture("palestinian-legislative-council")).find((s) => s.lang === "ar");
  const text = ar!.sections.map((s) => s.text).join("\n");
  const hasArabicIndic = /[٠-٩۰-۹]/.test(text);
  console.log(
    `    note  recorded ar article uses ${hasArabicIndic ? "Arabic-Indic" : "ASCII"} numerals` +
      `${hasArabicIndic ? "" : " — the normalisation path is covered by the synthetic cases above only"}`,
  );
  check(extractNumbers(text).has("74"), "ar seat figure reaches extractNumbers");
  check(extractNumbers(text).has("83"), "ar council size reaches extractNumbers");
}

// ---- screening --------------------------------------------------------------

console.log("\nSection screening");
const langs: Lang[] = ["en", "he", "ar"];
const sec = (text: string): Section => ({ heading: "h", level: 2, text });

const groups: SectionGroup[] = [
  {
    key: "lead",
    headings: {},
    sections: { en: sec("a".repeat(500)), he: sec("b".repeat(500)), ar: sec("c".repeat(500)) },
    reasons: [],
    order: -2,
  },
  {
    key: "key-facts",
    headings: {},
    sections: { en: sec("Seats: 74"), he: sec("Seats: 76"), ar: sec("Seats: 74") },
    reasons: [],
    order: -1,
  },
  {
    // Present everywhere, same figures, same length: the shape of a framing
    // difference, and exactly what the old score>0 filter discarded.
    key: "districts",
    headings: {},
    sections: {
      en: sec(`West Bank districts ${"x".repeat(400)}`),
      he: sec(`יהודה ושומרון ${"x".repeat(400)}`),
      ar: sec(`الضفة الغربية ${"x".repeat(400)}`),
    },
    reasons: [],
    order: 0,
  },
  { key: "en-only", headings: {}, sections: { en: sec("y".repeat(400)) }, reasons: [], order: 1 },
  { key: "empty", headings: {}, sections: {}, reasons: [], order: 2 },
];

const picked = screenGroups(groups, langs, 8);
const keys = picked.map((g) => g.key);
console.log(`    selected: ${keys.join(", ")}`);

check(keys.includes("lead"), "lead is always selected");
check(keys.includes("key-facts"), "key-facts is always selected");
check(keys.includes("districts"), "a no-divergence, equal-length group survives (framing)");
check(keys.includes("en-only"), "a single-language group survives (unique material)");
check(!keys.includes("empty"), "a group with no sections is dropped");
check(keys[0] === "lead", "lead ranks first");

check(
  screenGroups(groups, langs, 2).length === 2,
  "the limit still caps how many groups reach the model",
);

console.log("\nPreview scoping");

/** `n` characters of plausible prose: word breaks to clip at, paragraph breaks
 *  every so often, and exactly the length asked for. */
const prose = (n: number) =>
  // Nine characters a word, plus a couple spare so the slice below always has
  // enough to take.
  Array.from({ length: Math.ceil(n / 9) + 2 }, (_, i) => `word${String(i % 10000).padStart(4, "0")}`)
    .join(" ")
    .slice(0, n)
    .replace(/(.{700})/g, "$1\n")
    .slice(0, n);

const article = (lang: Lang, sections: Section[]): ArticleSnapshot => ({
  lang,
  title: `t-${lang}`,
  revid: 1,
  url: "",
  sections,
  linkQids: [],
});

/** The sections `Columns` lays out, which is what a cut is an index into. */
const bodyOf = (sections: Section[]) => sections.filter((s) => s.heading !== KEY_FACTS_HEADING);
const chars = (sections: Section[]) => sections.reduce((n, s) => n + s.text.length, 0);
const named = (heading: string, text: string): Section => ({ heading, level: 2, text });

// The three editions are never written to the same shape: one opens at length
// and continues in a handful of long sections, another says the same in twenty
// short ones. The whole point of a character budget is that all three are cut at
// the same depth anyway — the previous paragraph budget read a screenful of one
// and half the article of another, which is what made the previews inconsistent.
const shapes: Record<Lang, Section[]> = {
  en: [
    named(LEAD_HEADING, prose(1200)),
    named(KEY_FACTS_HEADING, prose(900)),
    ...Array.from({ length: 6 }, (_, i) => named(`en-${i}`, prose(1800))),
  ],
  he: [named(LEAD_HEADING, prose(400)), ...Array.from({ length: 30 }, (_, i) => named(`he-${i}`, prose(220)))],
  ar: [named(LEAD_HEADING, prose(9000))],
};

const previews = (Object.keys(shapes) as Lang[]).map((lang) =>
  previewOf(article(lang, shapes[lang])),
);
for (const { article: a, cut } of previews) {
  console.log(
    `    ${a.lang}: ${chars(bodyOf(a.sections))} chars, stops at section ${cut.section}+${cut.chars}`,
  );
}

const readChars = previews.map((p) => chars(bodyOf(p.article.sections)));
check(
  readChars.every((n) => n <= PREVIEW_CHARS),
  `no version is read past the ${PREVIEW_CHARS}-character budget`,
  readChars.join(", "),
);
check(
  Math.max(...readChars) - Math.min(...readChars) <= PREVIEW_CHARS / 10,
  "every version is read to within a tenth of the same depth, whatever its shape",
  readChars.join(", "),
);
check(
  previews.every(({ article: a }) => a.sections[0].heading === LEAD_HEADING),
  "the preview is a prefix: it starts at the lead",
);
check(
  previews.every(
    ({ article: a, cut }) => bodyOf(a.sections).length === cut.section + (cut.chars > 0 ? 1 : 0),
  ),
  "the cut names the last section the preview reached",
);

// The key-facts block sits above the columns rather than in them, so it is
// carried whole and costs the budget nothing — otherwise a long infobox could
// spend a preview before the lead had been read.
const withFacts = previews.find((p) => p.article.lang === "en")!;
check(
  withFacts.article.sections.some((s) => s.heading === KEY_FACTS_HEADING && s.text.length === 900),
  "key facts are carried whole and outside the budget",
);

// The fade in the columns starts exactly where the preview stopped, and `Columns`
// draws it by slicing the same section at `chars`. So the two halves have to be
// the article: nothing dropped at the seam, nothing shown twice.
const seam = previews.find((p) => p.cut.chars > 0)!;
{
  const { cut } = seam;
  const full = bodyOf(shapes[seam.article.lang]);
  const straddled = full[cut.section];
  const head = [
    ...full.slice(0, cut.section).map((s) => s.text),
    straddled.text.slice(0, cut.chars),
  ].join("");
  const tail = [
    straddled.text.slice(cut.chars),
    ...full.slice(cut.section + 1).map((s) => s.text),
  ].join("");

  check(
    head + tail === full.map((s) => s.text).join(""),
    "head and tail rejoin into the article with nothing lost or repeated at the seam",
  );
  check(
    head === bodyOf(seam.article.sections).map((s) => s.text).join(""),
    "what renders above the gate is exactly what the model was given",
  );
  check(
    /\s/.test(straddled.text.charAt(cut.chars)),
    "the cut lands on a word or paragraph break, never mid-word",
    JSON.stringify(straddled.text.slice(Math.max(0, cut.chars - 12), cut.chars + 4)),
  );
}

// A section cut in half must not keep links that reach past the cut: their
// offsets index text this copy no longer has.
{
  const long = prose(5000);
  const linked = previewOf(
    article("en", [
      { heading: LEAD_HEADING, level: 1, text: long, links: [
        { start: 5, end: 9, title: "near" },
        { start: 4500, end: 4504, title: "far" },
      ] },
    ]),
  );
  const kept = linked.article.sections[0].links ?? [];
  check(
    kept.length === 1 && kept[0].title === "near",
    "a link past the cut is dropped, one before it survives",
    kept.map((l) => l.title).join(","),
  );
  check(
    kept.every((l) => l.end <= linked.article.sections[0].text.length),
    "every surviving link still points inside the truncated text",
  );
}

// An article shorter than the budget is read whole, and says so — the columns
// must not fade out text the comparison actually covered.
{
  const short = previewOf(article("en", [named(LEAD_HEADING, prose(300)), named("s0", prose(400))]));
  check(
    short.cut.section === 2 && short.cut.chars === 0,
    "a short article is read whole and the cut says so",
    `${short.cut.section}+${short.cut.chars}`,
  );
  check(chars(bodyOf(short.article.sections)) === 700, "and none of it is truncated");
}

console.log("\nPricing");

// One summed token total cannot be priced: alignment runs on Haiku and the diff
// on Sonnet at three times the rate. These figures are chosen so that pricing
// the total at either single rate gives a visibly different answer from pricing
// the two apart, which is the bug the byModel breakdown exists to prevent.
const twoModels: Usage = {
  inputTokens: 30_000,
  outputTokens: 6_000,
  cachedInputTokens: 0,
  byModel: {
    "claude-haiku-4-5-20251001": { inputTokens: 10_000, outputTokens: 1_000, cachedInputTokens: 0 },
    "claude-sonnet-4-6": { inputTokens: 20_000, outputTokens: 5_000, cachedInputTokens: 0 },
  },
};
const split = costOfUsage(twoModels, "claude-sonnet-4-6");
const asIfAllSonnet = costOfUsage(
  { inputTokens: 30_000, outputTokens: 6_000, cachedInputTokens: 0 },
  "claude-sonnet-4-6",
);
// haiku 10k in @ $1 + 1k out @ $5 = $0.015; sonnet 20k in @ $3 + 5k out @ $15 = $0.135
check(Math.abs(split - 0.15) < 1e-9, "per-model usage prices each call at its own rate", `${split}`);
check(split < asIfAllSonnet, "pricing the summed total at one rate overstates the bill");

check(
  Math.abs(
    costOfUsage(
      { inputTokens: 1_000, outputTokens: 0, cachedInputTokens: 1_000 },
      "claude-sonnet-4-6",
    ) - 0.0003,
  ) < 1e-9,
  "cached input is billed at the cache-read rate, not the input rate",
);

// A model nobody has a rate for is a model somebody just set in the
// environment. Pricing it at zero would under-bill every donor silently, which
// is the one direction of wrong that nobody ever checks.
const unknown = ratesFor("claude-something-unreleased");
check(unknown.output >= 25, "an unknown model prices at the dearest rate, never at zero");

check(formatCost(0) === "$0.00", "nothing spent reads as zero");
check(formatCost(0.004) === "<$0.01", "a fraction of a cent never reads as free");
check(formatCost(0.1234) === "$0.12", "an ordinary run reads in cents");

check(articlesFor(500) === 25, "$5 buys 25 articles");
check(articlesFor(0) === 0, "an empty balance buys nothing");
check(articlesFor(-100) === 0, "a negative balance cannot buy a negative article");

console.log(failures ? `\n${failures} check(s) failed\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
