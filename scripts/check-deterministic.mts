/**
 * Assertions over the zero-token pass: coverage diffing, digit normalisation and
 * section screening. No network, no model, no database.
 *
 *   npm run check:deterministic
 */
import {
  coverageGaps,
  extractNumbers,
  normaliseDigits,
  screenGroups,
  type SectionGroup,
} from "../lib/deterministic";
import type { Lang, Section } from "../lib/types";
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
  },
  {
    key: "key-facts",
    headings: {},
    sections: { en: sec("Seats: 74"), he: sec("Seats: 76"), ar: sec("Seats: 74") },
    reasons: [],
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
  },
  { key: "en-only", headings: {}, sections: { en: sec("y".repeat(400)) }, reasons: [] },
  { key: "empty", headings: {}, sections: {}, reasons: [] },
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

console.log(failures ? `\n${failures} check(s) failed\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
