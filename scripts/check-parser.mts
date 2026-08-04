/**
 * Assertions over the recorded fixtures. No network, no model, no database.
 *
 *   npm run check:parser
 *
 * Generic checks run against every fixture; the Palestinian Legislative Council
 * case additionally asserts the hand-verified differences are present in the
 * parsed text, since a claim the model cannot see is a claim it cannot report.
 */
import { KEY_FACTS_HEADING, LEAD_HEADING, type Lang } from "../lib/types";
import { fixtureSnapshots, listFixtures, loadFixture } from "../fixtures/loader";

let failures = 0;

function check(ok: boolean, label: string, detail = ""): void {
  if (ok) {
    console.log(`    ok    ${label}`);
  } else {
    failures++;
    console.log(`    FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

/** Text that should never survive parsing: edit links, table markup, citation
 *  backlinks, and the section headings that are navigation rather than content. */
const CHROME_MARKERS: [string, RegExp][] = [
  ["english edit link", /(^|\n)\s*edit(\s|$)/],
  ["hebrew edit link", /עריכת קוד מקור|(^|\n)\s*עריכה\s*(\n|$)/],
  ["arabic edit link", /عدل المصدر|(^|\n)\s*عدل\s*(\n|$)/],
  ["raw html tag", /<\/?(div|table|span|td|tr|sup|ol)\b/i],
  ["citation marker", /\[\d+\]|\[edit\]|\[citation needed\]/],
];

const BOILERPLATE = /^(references|external links|see also|notes|further reading|קישורים חיצוניים|הערות שוליים|ראו גם|مراجع|وصلات خارجية|انظر أيضًا|انظر ايضا)$/;

for (const slug of listFixtures()) {
  const fixture = loadFixture(slug);
  const snaps = fixtureSnapshots(fixture);
  console.log(`\n${fixture.query}  (${fixture.qid}, captured ${fixture.capturedAt.slice(0, 10)})`);

  for (const snap of snaps) {
    const headings = snap.sections.map((s) => s.heading);
    const chars = snap.sections.reduce((n, s) => n + s.text.length, 0);
    console.log(`  ${snap.lang}: ${snap.sections.length} sections, ${chars}ch, ${snap.linkQids.length} qids`);

    check(snap.sections.length > 0, `${snap.lang} has sections`);
    check(snap.linkQids.length > 0, `${snap.lang} resolved link QIDs`);
    check(headings.includes(LEAD_HEADING), `${snap.lang} has a lead`);

    const boiler = headings.filter((h) => BOILERPLATE.test(h.trim()));
    check(boiler.length === 0, `${snap.lang} dropped boilerplate sections`, boiler.join(", "));

    for (const [label, re] of CHROME_MARKERS) {
      const hit = snap.sections.find((s) => re.test(s.text));
      check(!hit, `${snap.lang} free of ${label}`, hit && `in "${hit.heading}"`);
    }
  }
}

// ---- the hand-compared case -------------------------------------------------

const plc = loadFixture("palestinian-legislative-council");
const snaps = fixtureSnapshots(plc);
const textOf = (lang: Lang, heading?: string) =>
  snaps
    .filter((s) => s.lang === lang)
    .flatMap((s) => s.sections)
    .filter((s) => !heading || s.heading === heading)
    .map((s) => s.text)
    .join("\n");

console.log("\nPalestinian Legislative Council — known differences reachable in parsed text");

const expectations: [string, boolean][] = [
  ["he states 76 seats", /76/.test(textOf("he"))],
  ["he states 43 seats", /43/.test(textOf("he"))],
  ["en states 74 seats", /74/.test(textOf("en"))],
  ["en states 45 seats", /45/.test(textOf("en"))],
  ["ar states 74 seats", /74/.test(textOf("ar"))],
  ["ar states 45 seats", /45/.test(textOf("ar"))],
  ["ar states 83-member council", /83/.test(textOf("ar"))],
  ["en works from 88", /88/.test(textOf("en"))],
  ["he works from 88", /88/.test(textOf("he"))],
  ["he frames districts as Judea and Samaria", /יהודה ושומרון/.test(textOf("he"))],
  ["en frames districts as West Bank", /West Bank/.test(textOf("en"))],
  ["ar mentions East Jerusalem", /القدس/.test(textOf("ar"))],
  ["en covers the Goldstone Mission", /Goldstone/.test(textOf("en"))],
  ["en covers movement restrictions", /permit|movement/i.test(textOf("en"))],
  ["en covers detention of members", /detain|detention|arrest/i.test(textOf("en"))],
  ["en disputes PLC as parliament of the State of Palestine", /State of Palestine/.test(textOf("en"))],
  ["ar covers the legislative record", /1997/.test(textOf("ar")) && /1999/.test(textOf("ar"))],
  ["en key facts extracted", textOf("en", KEY_FACTS_HEADING).length > 40],
  ["he key facts extracted", textOf("he", KEY_FACTS_HEADING).length > 40],
  ["ar key facts extracted", textOf("ar", KEY_FACTS_HEADING).length > 40],
];

for (const [label, ok] of expectations) check(ok, label);

console.log(failures ? `\n${failures} check(s) failed\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
