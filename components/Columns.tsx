"use client";

import { Fragment, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import Highlighted from "./Highlighted";
import {
  KEY_FACTS_HEADING,
  LANG_META,
  LEAD_HEADING,
  type ArticleSnapshot,
  type Claim,
  type Lang,
  type LinkSpan,
  type PreviewCut,
  type Section,
} from "@/lib/types";

/** Every lead photo renders in a box this size regardless of its own aspect
 *  ratio, so the columns line up instead of stair-stepping by photo shape.
 *  `object-contain` letterboxes rather than crops, so nothing of the photo
 *  is lost. */
const IMAGE_WIDTH = 300;
const IMAGE_HEIGHT = 260;

/**
 * Where the row of columns stops being three, then two, then one.
 *
 * The editions are never the same length — an English article is routinely five
 * or ten times its Hebrew counterpart — so a row of equal columns runs out one
 * column at a time, and the rest of the page is spent setting whatever survives
 * in a third of the width beside two thirds of nothing. A band is the answer to
 * that: the article is laid out in as many bands as it has distinct endings, and
 * each band holds only the editions that still have text, sharing the whole
 * width between them.
 *
 * `from` is where each of this band's languages picks up, as an index into that
 * language's body sections. A band runs to wherever the next one's `from`
 * begins, or to the end of the article if there is no next one.
 */
interface Band {
  langs: Lang[];
  from: Partial<Record<Lang, number>>;
}

/** The one band every article starts as: every edition, from its first section.
 *  Also what the article stays as if nothing ever runs out early. */
const opening = (langs: Lang[]): Band => ({
  langs,
  from: Object.fromEntries(langs.map((lang) => [lang, 0])),
});

/** A continuation is only worth opening for a remainder taller than this. Below
 *  it the widened band is a stub, and re-flowing the page around it costs the
 *  reader more in surprise than the reclaimed width is worth. */
const MIN_CONTINUATION = 280;

/**
 * How wide the last edition standing sets its text.
 *
 * A band with one column in it has the whole page, and taking the whole page at
 * this type size is a 150-character line — the empty space would be gone and the
 * article unreadable instead. So the sheet narrows to the measure Wikipedia
 * itself sets an article at and the paper shows either side of it, which is also
 * the layout a reader arriving from the source article already knows.
 */
const READING_WIDTH = 960;

/** How tall the drawn seam between two bands is. Enough for the rules to travel
 *  their distance at a readable angle, short enough to read as a joint in the
 *  page rather than as a gap in the article. */
const BEND = 54;

/** The bend is drawn in thousandths of the page width, so its geometry survives
 *  the viewport changing under it between one measurement and the next. */
const SPAN = 1000;

/** `useLayoutEffect` on the server is a no-op React warns about, and the banding
 *  below is pure measurement — there is nothing for it to do before hydration. */
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Where a band's rules stand, as fractions of the page width: the two outer
 *  edges of the sheet and every seam between two columns. */
function boundaries(band: Band, inset: number): number[] {
  const columns = band.langs.length;
  const left = columns === 1 ? inset : 0;
  const span = 1 - 2 * left;
  return Array.from({ length: columns + 1 }, (_, i) => left + (span * i) / columns);
}

/**
 * The seam between two bands, drawn rather than written.
 *
 * An edition ending is a change in the shape of the page, and the page can say
 * so itself: every rule the band above stands on travels, in the depth of one
 * joint, to wherever the band below stands it. A seam whose column is gone
 * arrives at the same place as its neighbour and the wedge between them closes;
 * the sheet's own edges bend inwards where the last edition narrows to a
 * readable measure. The reader watches the columns become fewer and wider
 * instead of being told they have.
 *
 * Which rule goes where falls straight out of the reading order the columns keep
 * — the nth rule from the left lands on the nth rule from the left below,
 * counting only the editions that survive.
 */
function Bend({ above, below, inset }: { above: Band; below: Band; inset: number }) {
  const top = boundaries(above, inset).map((x) => x * SPAN);
  const stands = boundaries(below, inset);

  const steps = [0];
  let survivors = 0;
  for (const lang of above.langs) {
    if (below.langs.includes(lang)) survivors += 1;
    steps.push(survivors);
  }
  const foot = steps.map((step) => stands[step] * SPAN);

  const last = top.length - 1;
  const bend = (from: number, to: number) => `M ${from} 0 C ${from} 58, ${to} 42, ${to} 100`;

  return (
    <svg
      className="bend block w-full"
      style={{ height: BEND }}
      viewBox={`0 0 ${SPAN} 100`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {/* The sheet itself, carried across the joint so the article reads as one
          piece of paper changing shape rather than as two pages stacked. */}
      <path
        d={
          `${bend(top[0], foot[0])} L ${foot[last]} 100 ` +
          `C ${foot[last]} 42, ${top[last]} 58, ${top[last]} 0 Z`
        }
        fill="var(--color-wiki-page)"
      />
      {top.map((from, i) =>
        // An outer edge that stays at the edge of the page is not a rule anywhere
        // above or below this joint, so it is not one inside it either.
        (i === 0 || i === last) && from === foot[i] ? null : (
          <path
            key={i}
            d={bend(from, foot[i])}
            fill="none"
            stroke="var(--color-rule)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ),
      )}
    </svg>
  );
}

/**
 * Measure the last band and, if an edition ends inside it, open the next one.
 *
 * The cut is drawn at the shallowest column's last line. Every column keeps the
 * sections it has room for above that line and drops the rest into a new band —
 * one that no longer carries the edition which just ended, so the survivors
 * share a wider page between them.
 *
 * Nothing above a cut ever re-flows, because no column in this band changes
 * width, so the measurement that produced the cut stays true afterwards. And
 * every band drops at least one language (the shallowest column keeps all of its
 * sections by construction), which is what makes the sequence terminate.
 */
function grow(root: HTMLElement | null, bands: Band[]): Band[] | null {
  const band = bands[bands.length - 1];
  // One column has nothing to run out beside.
  if (!root || !band || band.langs.length < 2) return null;
  const el = root.querySelector<HTMLElement>(`[data-band="${bands.length - 1}"]`);
  if (!el) return null;

  const columns: { lang: Lang; ends: number[] }[] = [];
  for (const lang of band.langs) {
    const column = el.querySelector<HTMLElement>(`[data-edition="${lang}"]`);
    const blocks = column ? [...column.querySelectorAll<HTMLElement>("[data-block]")] : [];
    if (!column || !blocks.length) return null;
    const top = column.getBoundingClientRect().top;
    columns.push({ lang, ends: blocks.map((b) => b.getBoundingClientRect().bottom - top) });
  }

  const bottom = (column: { ends: number[] }) => column.ends[column.ends.length - 1];
  const floor = Math.min(...columns.map(bottom));

  const next: Band = { langs: [], from: {} };
  let remainder = 0;
  for (const column of columns) {
    // The first section hanging below the shallowest column's last line.
    let kept = column.ends.findIndex((end) => end > floor + 1);
    if (kept < 0) continue; // this edition ends inside the band
    // The section straddling that line goes wherever it leaves less paper blank.
    // Cutting strictly above it would bank every column's overhang as white
    // space at the foot of this band, which is the thing bands exist to spend.
    const above = floor - (kept > 0 ? column.ends[kept - 1] : 0);
    const below = column.ends[kept] - floor;
    if (below < above) kept += 1;
    // A column reduced to its title and photo with the text moved out from under
    // them reads as broken rather than as continued.
    kept = Math.max(kept, 1);
    if (kept >= column.ends.length) continue;
    next.langs.push(column.lang);
    next.from[column.lang] = (band.from[column.lang] ?? 0) + kept;
    remainder = Math.max(remainder, bottom(column) - column.ends[kept - 1]);
  }

  if (!next.langs.length || next.langs.length >= band.langs.length) return null;
  if (remainder < MIN_CONTINUATION) return null;
  return [...bands, next];
}

/**
 * A section reduced to a character range of its own text, links carried along.
 *
 * The preview's boundary is a character count and lands wherever it lands, so a
 * section can be cut in half and its two halves rendered on opposite sides of
 * the gate. Links whose span straddles the cut are dropped rather than clipped:
 * half an anchor is not a link to anything.
 */
function sliceSection(section: Section, from: number, to = section.text.length): Section {
  return {
    ...section,
    text: section.text.slice(from, to),
    links: section.links
      ?.filter((l) => l.start >= from && l.end <= to)
      .map((l) => ({ ...l, start: l.start - from, end: l.end - from })),
  };
}

/**
 * The articles, side by side. Rendered as soon as the text exists — before any
 * comparison — so the reader confirms they picked the right subject by reading
 * it, and so the wait is spent on the article rather than on a spinner.
 *
 * `ghost` marks drift over arbitrary phrases while the comparison runs: they
 * say the text is being read, and are visibly not findings — no hover, no
 * card, no tick on the rail.
 */
export default function Columns({
  articles,
  visible,
  claims,
  ghost = false,
  activeId = null,
  processedThrough,
  part = "whole",
  onEnter,
  onLeave,
  onLink,
}: {
  articles: Record<string, ArticleSnapshot>;
  visible: Lang[];
  claims: Claim[];
  ghost?: boolean;
  activeId?: string | null;
  /**
   * Per language, where this comparison stopped reading. Absent means the whole
   * article was read and there is nothing to split.
   *
   * It is per language rather than one number because the editions are written
   * at different lengths: the same character budget reaches the fourth section
   * of one and stops half way through the second of another.
   */
  processedThrough?: Partial<Record<Lang, PreviewCut>>;
  /**
   * `whole` is the ordinary render. A funded comparison never needs anything
   * else. A preview renders twice — `head`, then the gate, then `tail` — so the
   * boundary can be a rule straight across all three columns rather than three
   * ragged fades at three different heights. `tail` drops the column heading,
   * title, image and key facts, because those belong to the top of the article
   * and printing them twice would read as the page having started over.
   */
  part?: "whole" | "head" | "tail";
  onEnter?: (claim: Claim, event: React.MouseEvent | React.FocusEvent) => void;
  onLeave?: () => void;
  onLink?: (title: string, lang: Lang) => void;
}) {
  // One state for every column's "Key facts" accordion, so opening it in any
  // language opens it in all of them — they're the same disclosure, just
  // shown three times.
  const [keyFactsOpen, setKeyFactsOpen] = useState(false);

  const wrap = useRef<HTMLDivElement>(null);
  /** `width` is the page the bands were measured against. The margins that
   *  narrow the last band are written as a percentage of it and the bend is
   *  drawn in fractions of it, so the two are the same number and cannot drift
   *  apart — the rules land where the columns actually stand. */
  const [layout, setLayout] = useState<{ sig: string; bands: Band[]; width: number }>({
    sig: "",
    bands: [],
    width: 0,
  });
  /** The signature whose banding has stopped growing, so the measuring pass can
   *  step aside on every ordinary re-render — a hover changes the marks, not the
   *  endings, and re-reading every block's rect for it would cost a reflow. */
  const settled = useRef("");
  const [reflow, again] = useReducer((n: number) => n + 1, 0);

  // The bands are measured, so anything that moves an ending invalidates them
  // rather than adjusting them. Web fonts land after the first paint and shift
  // every line in the document; a resize changes the column width the endings
  // were measured at.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(again, 150);
    };
    window.addEventListener("resize", onResize);
    document.fonts?.ready.then(() => again());
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  // A preview is already cut across all three columns at the gate, and its
  // remainder is a fading 340px block: neither half has an ending to re-flow
  // around. Below `cols` there is one column on screen, which cannot run out
  // beside anything.
  const banding = part === "whole" && visible.length > 1;
  const signature = `${visible.join(",")}|${visible
    .map((lang) => articles[lang]?.revid ?? 0)
    .join(",")}|${reflow}`;

  useBrowserLayoutEffect(() => {
    if (!banding) {
      if (layout.bands.length) setLayout({ sig: "", bands: [], width: 0 });
      return;
    }
    const width = wrap.current?.clientWidth ?? 0;
    if (layout.sig !== signature) {
      settled.current = "";
      setLayout({ sig: signature, bands: [opening(visible)], width });
      return;
    }
    if (settled.current === signature) return;
    // Each pass measures the band the previous pass opened, so the whole
    // sequence resolves in at most one pass per language, before the paint.
    const grown = grow(wrap.current, layout.bands);
    if (grown) setLayout({ sig: signature, bands: grown, width });
    else settled.current = signature;
  }, [banding, signature, layout, visible]);

  const banded = banding && layout.sig === signature && layout.bands.length > 0;
  const bands = banded ? layout.bands : [opening(visible)];
  /** How far in from each page edge the last edition standing sets its text. */
  const inset =
    layout.width > READING_WIDTH ? (layout.width - READING_WIDTH) / (2 * layout.width) : 0;

  const bodyOf = (lang: Lang): Section[] => {
    const article = articles[lang];
    if (!article) return [];
    const all = article.sections.filter((s) => s.heading !== KEY_FACTS_HEADING);
    const cut = processedThrough?.[lang];
    if (!cut || part === "whole") return all;

    // `chars` is how far into `section` the preview got, so that section belongs
    // to both halves: its opening above the gate and its remainder below.
    const straddled = cut.chars > 0 ? all[cut.section] : undefined;
    if (part === "head") {
      const head = all.slice(0, cut.section);
      if (straddled) head.push(sliceSection(straddled, 0, cut.chars));
      return head;
    }

    const tail = all.slice(straddled ? cut.section + 1 : cut.section);
    // The remainder keeps its text and loses its heading — LEAD_HEADING is how a
    // block says it has none — because the heading was printed above the gate,
    // and printing it again would read as the section having started over.
    if (straddled) {
      tail.unshift({ ...sliceSection(straddled, cut.chars), heading: LEAD_HEADING });
    }
    return tail;
  };

  return (
    <div ref={wrap} className="columns-flow" aria-hidden={part === "tail" ? true : undefined}>
      {bands.map((band, bandIndex) => {
        const following = bands[bandIndex + 1];
        const closing = bandIndex === bands.length - 1;
        // The last edition standing narrows to a readable measure and lets the
        // paper show either side of it, which is what makes the sheet's own
        // edges something the bend above can bring in.
        const alone = band.langs.length === 1 && inset > 0;
        return (
          <Fragment key={bandIndex}>
            {bandIndex > 0 && <Bend above={bands[bandIndex - 1]} below={band} inset={inset} />}
            <div
              data-band={bandIndex}
              className={`${
                part === "tail"
                  ? // The unread remainder. It fades out rather than being cut off, because
                    // the article does not end there — only our reading of it does.
                    // No `user-select: none`: the text below the gate is Wikipedia's own,
                    // free to anyone, and locking it would be charging for something we
                    // neither wrote nor paid for. Only the comparison is unfunded.
                    // `pointer-events` is off because there is nothing here to hover — no
                    // marks were placed in this half — and a help cursor over plain text
                    // would promise a card that never opens.
                    // Both spellings of the mask: Safari still wants the prefix, and
                    // dropping it would cut the remainder off flat rather than fading it.
                    // The height is capped where the fade reaches transparent, so the
                    // document ends with the fade and the footer follows it. Everything
                    // past that point was invisible anyway, and scrolling through it —
                    // or having a script hold the page back from it — made the article
                    // feel broken rather than paywalled.
                    "columns columns-faded [-webkit-mask-image:linear-gradient(to_bottom,black_0,transparent_340px)] [mask-image:linear-gradient(to_bottom,black_0,transparent_340px)] pointer-events-none max-h-[340px] overflow-hidden"
                  : bandIndex === 0
                    ? "columns"
                    : "columns-more"
              } grid max-cols:block items-stretch bg-wiki-page ${
                // A band this narrow is always the last one — nothing can run out
                // beside a single column — so it is ruled on three sides and the
                // sheet closes rather than running off the foot of the article.
                alone ? "border-x border-b border-rule" : ""
              }`}
              style={{
                gridTemplateColumns: `repeat(${band.langs.length}, minmax(0, 1fr))`,
                // Written as a percentage of the same width the bend is drawn
                // in, so the sheet's edges and the rules that arrive at them are
                // one measurement rather than two that can disagree.
                marginInline: alone ? `${inset * 100}%` : undefined,
              }}
            >
              {band.langs.map((lang) => {
                const article = articles[lang];
                if (!article) return null;
                const meta = LANG_META[lang];
                const keyFacts = article.sections.find((s) => s.heading === KEY_FACTS_HEADING);
                const all = bodyOf(lang);
                const from = band.from[lang] ?? 0;
                const to = following?.langs.includes(lang) ? following.from[lang]! : all.length;
                const body = all.slice(from, to);
                const chrome = bandIndex === 0 && part !== "tail";
                // This edition stops here while the page carries on without it. Said
                // out loud, because a column that simply stopped next to one that
                // did not would read as text we had dropped.
                const closes = !closing && !following?.langs.includes(lang);
                const highlight = (text: string, links?: LinkSpan[]) => (
                  <Highlighted
                    text={text}
                    lang={lang}
                    claims={claims}
                    links={links}
                    ghost={ghost}
                    activeId={activeId}
                    onEnter={onEnter}
                    onLeave={onLeave}
                    onLink={onLink}
                  />
                );
                // `data-block` is what the banding measures against: one rect per
                // section, and the cut falls between two of them.
                const block = (section: Section, i: number) => (
                  <div key={`${section.heading}-${i}`} data-block>
                    {section.heading !== LEAD_HEADING && (
                      <h3 className="section-heading mt-[26px] mb-2 pb-[5px] font-wiki-heading text-[21px] font-normal border-b border-wiki-border text-wiki-text">
                        {section.heading}
                      </h3>
                    )}
                    {highlight(section.text, section.links)}
                  </div>
                );
                return (
                  // Physical, not inline: columns always sit en|he|ar left-to-right
                  // regardless of each column's own direction, so the seam belongs
                  // between every pair.
                  <section
                    key={lang}
                    data-edition={lang}
                    // The deeper bottom padding is for the floating language switch
                    // below `cols` and the footer above it: the article's last
                    // paragraph must not end up underneath either. A band with more
                    // article below it wants neither — the gap would read as the
                    // text having stopped.
                    className={`${bandIndex === 0 ? "column" : "column-more"} min-w-0 pt-[22px] px-[26px] ${
                      closing ? "pb-20 max-cols:pb-[110px]" : "pb-10"
                    } max-tight:px-[17px] border-rule border-l first:border-l-0 max-cols:border-l-0 max-cols:border-t max-cols:first:border-t-0`}
                    dir={meta.dir}
                    lang={lang}
                  >
                    {chrome && (
                      <div className="column-head flex items-baseline gap-2.5 pb-2.5 mb-4 border-b-2 border-ink font-mono text-[12px] text-ink-soft">
                        <span className="native font-body text-[17px] text-ink">{meta.native}</span>
                        <span className="arrow text-[13px] text-ink" aria-hidden="true">
                          {meta.dir === "rtl" ? "←" : "→"}
                        </span>
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-wiki-link no-underline hover:underline"
                        >
                          rev {article.revid}
                        </a>
                        {/* The licence the text below is under, beside the
                            revision it came from. CC BY-SA asks to be named
                            wherever the material is; naming it once in the
                            footer would leave three columns of somebody else's
                            prose with nothing on them saying so. */}
                        <a
                          href="https://creativecommons.org/licenses/by-sa/4.0/"
                          target="_blank"
                          rel="license noreferrer"
                          className="ms-auto text-wiki-link no-underline hover:underline"
                        >
                          CC BY-SA 4.0
                        </a>
                      </div>
                    )}
                    {chrome && (
                      <h1 className="article-title m-0 mb-3.5 pb-2 text-[26px] leading-tight font-wiki-heading font-normal border-b border-wiki-border text-wiki-text">
                        {article.title}
                      </h1>
                    )}
                    {chrome && article.image && (
                      <figure className="m-0 mb-4">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className="article-image block mx-auto object-contain m-0 p-1 bg-wiki-page rounded-[2px]"
                          style={{ width: IMAGE_WIDTH, height: IMAGE_HEIGHT }}
                          src={article.image.src}
                          alt={article.image.alt ?? article.title}
                          loading="lazy"
                        />
                        {/* The photographer and the terms. Small, because it is
                            not for the reader so much as owed to whoever took
                            the picture — but present, because a CC BY-SA photo
                            shown without it is a photo shown without permission. */}
                        {article.image.credit && (
                          <figcaption className="article-image-credit mt-[6px] text-center font-mono text-[10px] leading-[1.5] text-ink-soft">
                            {article.image.credit.artist && <>{article.image.credit.artist} · </>}
                            <a
                              href={article.image.credit.licenseUrl ?? article.image.credit.fileUrl}
                              target="_blank"
                              rel="license noreferrer"
                              className="text-wiki-link no-underline hover:underline"
                            >
                              {article.image.credit.license}
                            </a>
                          </figcaption>
                        )}
                      </figure>
                    )}
                    {chrome && keyFacts && (
                      <details
                        className="key-facts group mb-5 border border-wiki-border rounded-[2px] bg-wiki-shade"
                        open={keyFactsOpen}
                        onToggle={(e) => setKeyFactsOpen(e.currentTarget.open)}
                      >
                        <summary className="cursor-pointer py-2 px-3 font-mono text-[11px] tracking-[0.09em] uppercase text-ink-soft select-none group-open:border-b group-open:border-wiki-border">
                          Key facts
                        </summary>
                        <dl className="kf-body m-0 pt-1.5 px-3 pb-2.5 text-[13.5px] text-wiki-text">
                          {keyFacts.text.split("\n").map((line, i) => {
                            // A claim can span the label and value of one row, so a row
                            // carrying one stays a single highlightable unit rather than
                            // being split into bold label + value.
                            const hasClaim = claims.some(
                              (c) => c.spans[lang] && line.includes(c.spans[lang]!),
                            );
                            if (hasClaim) {
                              return (
                                <div
                                  key={i}
                                  className="kf-row kf-row-full block py-[5px] border-t border-wiki-rule first:border-t-0"
                                >
                                  {highlight(line)}
                                </div>
                              );
                            }
                            const sep = line.indexOf(": ");
                            if (sep === -1) {
                              return (
                                <div
                                  key={i}
                                  className="kf-group pt-2 pb-0.5 font-bold text-center text-ink-soft"
                                >
                                  {line}
                                </div>
                              );
                            }
                            return (
                              <div
                                key={i}
                                className="kf-row grid grid-cols-[minmax(0,38%)_minmax(0,1fr)] gap-y-0.5 gap-x-3 py-[5px] border-t border-wiki-rule first:border-t-0"
                              >
                                <dt className="kf-label m-0 font-bold">{line.slice(0, sep)}</dt>
                                <dd className="kf-value m-0">{line.slice(sep + 2)}</dd>
                              </div>
                            );
                          })}
                        </dl>
                      </details>
                    )}
                    {body.map(block)}
                    {closes && (
                      // The one thing on this page that is written rather than
                      // drawn, and the reason it is: a column of Hebrew that simply
                      // stopped beside a column of English that did not would read
                      // as text we had dropped. So it is set as a colophon — a rule
                      // in full ink across the column, the edition named in its own
                      // script, and the sentence under it in the interface's voice
                      // rather than the article's.
                      <div className="column-ends mt-9 pt-4 border-t-2 border-ink text-center">
                        <div className="font-body text-[24px] leading-none text-ink">
                          {meta.native}
                        </div>
                        <div className="mt-2 font-mono text-[11px] tracking-[0.18em] uppercase text-ink-soft">
                          end of the {meta.label} article
                        </div>
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}
