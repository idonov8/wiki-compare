/**
 * Assertions over the zero-token pass: coverage diffing, digit normalisation and
 * section screening. No network, no model, no database.
 *
 *   npm run check:deterministic
 */
import {
  PREVIEW_SECTIONS,
  coverageGaps,
  extractNumbers,
  normaliseDigits,
  previewGroups,
  screenGroups,
  type SectionGroup,
} from "../lib/deterministic";
import { articlesFor, costOfUsage, formatCost, ratesFor } from "../lib/pricing";
import type { Lang, Section, Usage } from "../lib/types";
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

// The preview is a prefix of the article, not the most divergent parts of it.
// The fade in the columns starts where this stops, and a fade is only coherent
// if everything above it was read — so the assertion that matters is
// contiguity, not which groups happen to score highest.
const previewed = previewGroups(groups);
const previewKeys = previewed.map((g) => g.key);
console.log(`    previewed: ${previewKeys.join(", ")}`);

check(previewKeys.includes("lead"), "the lead is always in the preview");
check(previewKeys.includes("key-facts"), "key facts are always in the preview");
check(
  previewed.filter((g) => g.order >= 0).length === PREVIEW_SECTIONS,
  `exactly ${PREVIEW_SECTIONS} ordinary sections are previewed`,
);
check(
  previewed.every((g, i) => i === 0 || g.order >= previewed[i - 1].order),
  "the previewed groups come back in document order",
);
const ordinary = previewed.filter((g) => g.order >= 0).map((g) => g.order);
check(
  ordinary.every((o, i) => i === 0 || o === ordinary[i - 1] + 1),
  "the previewed sections are contiguous, with no gap for the fade to start inside",
);
// The shared fixture has only four scoring groups, so a preview of it is the
// whole thing and proves nothing. Truncation only means anything on an article
// long enough to be truncated.
const longArticle: SectionGroup[] = [
  groups[0],
  groups[1],
  ...Array.from({ length: 8 }, (_, i) => ({
    key: `s${i}`,
    headings: {},
    sections: { en: sec("z".repeat(400)), he: sec("z".repeat(400)) },
    reasons: [],
    order: i,
  })),
];
check(
  previewGroups(longArticle).length < screenGroups(longArticle, langs, 8).length,
  "on a long article a preview reads strictly less than a full run",
  `preview ${previewGroups(longArticle).length}, full ${screenGroups(longArticle, langs, 8).length}`,
);
check(
  previewGroups(longArticle).filter((g) => g.order >= 0).every((g) => g.order < PREVIEW_SECTIONS),
  "the preview stops at the boundary rather than sampling past it",
);

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
