"use client";

import { LANG_META, type Lang } from "@/lib/types";

/**
 * The coverage diff, in one sentence, above the columns it describes.
 *
 * It was a panel at the foot of the page: a heading, a paragraph explaining
 * itself, and every gap as a pill. That is a lot of page for a fact a reader
 * wants before they start reading — that one edition links two hundred concepts
 * the others never mention is the shape of the article, and the shape belongs at
 * the top. So the labels are gone and the counts stay: a reader who wants the
 * concepts themselves reads the columns, which is where they are anyway.
 *
 * The whole line is arithmetic over Wikidata ids — no model said any of it, and
 * the note at the end says so. Everything else on the page that reads like a
 * finding came out of one, so a computed number sitting among them has to be
 * marked as computed or it inherits their provenance.
 */
export default function Coverage({ only }: { only?: Partial<Record<Lang, number>> }) {
  // Largest first: the sentence is a ranking, and the edition covering the most
  // ground alone is the one worth reading first. An edition with nothing unique
  // to it drops out rather than reading "0".
  const counted = (Object.entries(only ?? {}) as [Lang, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!counted.length) return null;

  const [lead, ...rest] = counted;
  const sentence =
    `${lead[1].toLocaleString()} linked concept${lead[1] === 1 ? " appears" : "s appear"} ` +
    `only in ${LANG_META[lead[0]].label}` +
    rest.map(([lang, n]) => `, ${n.toLocaleString()} only in ${LANG_META[lang].label}`).join("") +
    ".";

  return (
    <div className="coverage border-b border-rule px-[24px] py-[11px] max-tight:px-[18px] flex flex-wrap items-baseline gap-x-[14px] gap-y-[4px]">
      <h2 className="m-0 font-mono text-[11px] font-normal tracking-[0.09em] uppercase text-ink-soft">
        Coverage
      </h2>
      <p
        className="m-0 text-[14px] leading-[1.5] text-ink"
        title="A concept counts as linked where the article links the Wikipedia page for it. Navboxes, citations and calendar links are not concepts and are not counted."
      >
        {sentence}
      </p>
      {/* Against the right margin while it shares the line with the sentence,
          and back against the left once it wraps below it — a note set right on
          a line of its own reads as a caption to nothing. */}
      <p className="m-0 ms-auto max-cols:ms-0 font-mono text-[11px] text-ink-soft">
        computed from Wikidata links, not read by a model
      </p>
    </div>
  );
}
