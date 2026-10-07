/**
 * Assertions over how the Jev engine cuts articles into paragraphs and
 * sentences. No network, no model.
 *
 *   npm run check:segment
 */
import { fixtureSnapshots, listFixtures, loadFixture } from "../fixtures/loader";
import { MIN_PARAGRAPH, MIN_SENTENCE, segment } from "../lib/jev/segment";

let failures = 0;

function check(ok: boolean, label: string, detail = ""): void {
  if (ok) {
    console.log(`    ok    ${label}`);
  } else {
    failures++;
    console.log(`    FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

for (const slug of listFixtures()) {
  console.log(`\n${slug}`);
  for (const article of fixtureSnapshots(loadFixture(slug))) {
    const { paragraphs } = segment(article);
    const sentences = paragraphs.flatMap((p) => p.sentences);
    const sectionOf = (i: number) => article.sections[i].text;

    const misplaced = [...paragraphs, ...sentences].filter(
      (u) => sectionOf(u.section).slice(u.start, u.end) !== u.text || !sectionOf(u.section).includes(u.text),
    );
    check(!misplaced.length, `${article.lang}: every unit is a slice of its section`, misplaced[0]?.text.slice(0, 60));

    const outside = sentences.filter((s) => {
      const p = paragraphs.find((x) => x.sentences.includes(s))!;
      return s.start < p.start || s.end > p.end;
    });
    check(!outside.length, `${article.lang}: every sentence lies inside its paragraph`);

    const ragged = [...paragraphs, ...sentences].filter((u) => u.text !== u.text.trim() || /^[•·*]/.test(u.text));
    check(!ragged.length, `${article.lang}: no unit starts with whitespace or a bullet`, ragged[0]?.text.slice(0, 40));

    const tiny = sentences.filter((s) => s.text.length < MIN_SENTENCE && paragraphs.find((p) => p.sentences.includes(s))?.kind === "body");
    check(!tiny.length, `${article.lang}: no body sentence under ${MIN_SENTENCE} chars`);

    // A short paragraph is allowed only when it is all its section has.
    const stranded = paragraphs.filter(
      (p) =>
        p.kind === "body" &&
        p.text.length < MIN_PARAGRAPH &&
        paragraphs.filter((q) => q.kind === "body" && q.section === p.section).length > 1,
    );
    check(!stranded.length, `${article.lang}: short lines are folded into a neighbour`, stranded[0]?.text.slice(0, 60));

    const body = paragraphs.filter((p) => p.kind === "body");
    console.log(
      `          ${article.lang}: ${body.length} paragraphs, ${paragraphs.length - body.length} fact lines, ${sentences.length} sentences`,
    );
  }
}

console.log("\npalestinian-legislative-council: known units");
const plc = segment(fixtureSnapshots(loadFixture("palestinian-legislative-council")).find((a) => a.lang === "he")!);
const seats1996 = plc.paragraphs.find((p) => p.text.includes("68 מושבים"));
check(
  !!seats1996 && seats1996.text.includes("12 מושבים") && seats1996.text.includes("88 מושבים"),
  "he: the 1996 seat list is one paragraph with its lead-in",
);
check(
  !!seats1996 && seats1996.sentences.some((s) => s.text.startsWith('פת"ח: 68 מושבים')),
  "he: each list item is its own sentence",
);
check(
  plc.paragraphs.some((p) => p.text.includes("74 מושבים") && p.text.includes("עצמאים: 4 מושבים")),
  "he: the 2006 seat list is not split by a long item",
);
const malfunction = segment(fixtureSnapshots(loadFixture("palestinian-legislative-council")).find((a) => a.lang === "en")!)
  .paragraphs.filter((p) => p.heading === "Malfunction");
check(malfunction.length >= 6, "en: long bullets stay separate points", `${malfunction.length} paragraphs`);
check(
  plc.paragraphs.some((p) => p.kind === "facts" && p.text.includes("עזיז דוויק")),
  "he: the speaker infobox line is a fact unit",
);

console.log(failures ? `\n${failures} check(s) failed\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
