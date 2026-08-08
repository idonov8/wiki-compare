"use client";

import Section from "./Section";
import { GLOSS, SAMPLE, type SampleExcerpt } from "./sample";
import { LANG_META } from "@/lib/types";

/** The band a mark of each kind wears, matching the article surface exactly. */
const MARK: Record<string, string> = {
  contradiction: "bg-mark-contradiction inset-shadow-contradiction",
  unique: "bg-mark-unique inset-shadow-unique",
  framing: "bg-mark-framing inset-shadow-framing",
};

const KIND_LABEL: Record<string, string> = {
  contradiction: "Contradiction",
  unique: "Only in one version",
  framing: "Different framing",
};

/**
 * One real disagreement, before the reader has run anything.
 *
 * The section is the site's argument in the site's own materials: the three
 * excerpts sit on the same off-white Wikipedia surface the real columns use,
 * set in the same faces, marked with the same band. Somebody who scrolls this
 * far has seen the product, not a description of it.
 *
 * The text is verbatim and static — see `./sample` for why it cannot be fetched
 * and must not be reworded.
 */
export default function SampleDiff({ onOpen }: { onOpen: (title: string, lang: string) => void }) {
  return (
    <Section
      numeral="II."
      kicker="One example"
      heading="Three encyclopaedias, one map, three names for it."
      className="py-[max(7vh,52px)]"
    >
      <p className="mt-[16px] mb-0 max-w-[52ch] text-[15px] leading-[1.65] text-ink-soft">
        From{" "}
        <i>
          {SAMPLE.title}
        </i>
        , as the three Wikipedias have it today. Nothing here is paraphrased.
      </p>

      <div className="mt-[28px] grid grid-cols-3 gap-[14px] max-cols:grid-cols-1">
        {SAMPLE.excerpts.map((excerpt) => (
          <Excerpt key={excerpt.lang} excerpt={excerpt} />
        ))}
      </div>

      {/* The claim card, in the house style — the same panel a real mark opens
          when the reader hovers it, so the gesture is already learned by the
          time they meet one. */}
      <div className="mt-[18px] flex items-start gap-[14px] border border-ink bg-paper-raised px-[16px] py-[14px] shadow-offset max-tight:flex-col max-tight:gap-[10px]">
        <span
          className={`shrink-0 rounded-[2px] px-[8px] py-[2px] font-mono text-[10px] tracking-[0.09em] uppercase text-ink ${MARK[SAMPLE.type]}`}
        >
          {KIND_LABEL[SAMPLE.type]}
        </span>
        <p className="m-0 text-[14px] leading-[1.6]">
          <b className="font-semibold">{SAMPLE.summary}.</b>{" "}
          <span className="text-ink-soft">{SAMPLE.explanation}</span>
        </p>
      </div>

      <button
        type="button"
        className="mt-[20px] border border-ink bg-transparent px-[16px] py-[8px] font-mono text-[12px] tracking-[0.04em] text-ink transition-colors duration-[120ms] hover:bg-ink hover:text-paper-raised"
        onClick={() => onOpen(SAMPLE.title, SAMPLE.lang)}
      >
        Open this comparison →
      </button>
    </Section>
  );
}

/**
 * One column. `dir` and `lang` come off `LANG_META` rather than being written
 * in, and the mark is applied by splitting on the recorded substring — the same
 * shape as the real highlighter, so a span that begins or ends at a direction
 * boundary breaks here in exactly the way it would break there.
 */
function Excerpt({ excerpt }: { excerpt: SampleExcerpt }) {
  const meta = LANG_META[excerpt.lang];
  const at = excerpt.text.indexOf(excerpt.mark);
  const before = at === -1 ? excerpt.text : excerpt.text.slice(0, at);
  const after = at === -1 ? "" : excerpt.text.slice(at + excerpt.mark.length);

  return (
    <figure className="m-0 flex flex-col border border-wiki-border bg-wiki-page">
      <figcaption className="flex items-baseline justify-between gap-[8px] border-b border-wiki-rule bg-wiki-shade px-[12px] py-[7px] font-mono text-[11px] tracking-[0.08em] uppercase text-ink-soft">
        <span>{excerpt.lang}</span>
        <span className="normal-case tracking-normal" lang={excerpt.lang} dir={meta.dir}>
          {meta.native}
        </span>
      </figcaption>

      <blockquote
        className="m-0 flex-1 px-[13px] py-[12px] font-wiki text-[13.5px] leading-[1.7] text-wiki-text"
        lang={excerpt.lang}
        dir={meta.dir}
        cite={`https://${excerpt.lang}.wikipedia.org/`}
      >
        {excerpt.elided && <span className="text-wiki-border">…</span>}
        {before}
        {at !== -1 && (
          // `text-inherit` because a bare <mark> comes with the browser's own
          // black-on-yellow, which is not this site's vocabulary for anything.
          <mark className={`rounded-[1px] text-inherit ${MARK[SAMPLE.type]}`}>{excerpt.mark}</mark>
        )}
        {after}
      </blockquote>

      {/* The gloss is not decoration. A reader who cannot read Hebrew or Arabic
          can see that the three marks differ but not how, and "they differ" is
          not the finding — what they say is. */}
      <p
        className="m-0 border-t border-wiki-rule px-[13px] py-[8px] font-mono text-[11px] leading-[1.5] text-ink-soft"
        dir="ltr"
      >
        {GLOSS[excerpt.lang]}
      </p>
    </figure>
  );
}
