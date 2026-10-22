/**
 * Assertions over the zero-token pass: coverage diffing, digit normalisation and
 * pricing. No network, no model, no database.
 *
 *   npm run check:deterministic
 */
import { coverageGaps, extractNumbers, normaliseDigits } from "../lib/deterministic";
import { costOfUsage, formatCost, ratesFor } from "../lib/pricing";
import type { Usage } from "../lib/types";
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

console.log("\nPricing");

// One summed token total cannot be priced when a run spans models at different
// rates. These figures are chosen so that pricing the total at either single
// rate gives a visibly different answer from pricing the two apart, which is the
// bug the byModel breakdown exists to prevent.
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
// environment. Pricing it at zero would understate every run silently, which
// is the one direction of wrong that nobody ever checks.
const unknown = ratesFor("claude-something-unreleased");
check(unknown.output >= 25, "an unknown model prices at the dearest rate, never at zero");

check(formatCost(0) === "$0.00", "nothing spent reads as zero");
check(formatCost(0.004) === "<$0.01", "a fraction of a cent never reads as free");
check(formatCost(0.1234) === "$0.12", "an ordinary run reads in cents");

console.log(failures ? `\n${failures} check(s) failed\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
