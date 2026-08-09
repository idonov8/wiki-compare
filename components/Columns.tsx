"use client";

import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import Highlighted from "./Highlighted";
import {
  KEY_FACTS_HEADING,
  LANG_META,
  LEAD_HEADING,
  type ArticleSnapshot,
  type Claim,
  type Lang,
  type LinkSpan,
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

/** The most runs a widened column will set its remainder in. */
const MAX_RUNS = 3;

/** `useLayoutEffect` on the server is a no-op React warns about, and the banding
 *  below is pure measurement — there is nothing for it to do before hydration. */
const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Roughly how many lines a section sets in. Characters alone underweight a
 *  list, which is most of what an article's later sections are: a one-word
 *  bullet ends where it ends and still costs a whole line of height. */
function depth(section: Section): number {
  const PER_LINE = 64;
  let total = section.heading === LEAD_HEADING ? 0 : 3; // the heading and its rule
  for (const line of section.text.split("\n")) {
    total += Math.max(1, Math.ceil(line.length / PER_LINE));
  }
  return total;
}

/**
 * Split a column's sections into `count` runs of roughly equal length, in order.
 *
 * The last band is one edition across the whole page, which at this type size is
 * a 150-character line: the empty space would be gone and the article unreadable
 * instead. So a column that has swallowed its neighbours' width sets its
 * remainder in as many runs as it swallowed columns, newspaper fashion. The runs
 * are contiguous rather than balanced by a bin-packer — reading order is the
 * whole point, and a run has to be the piece that follows the one beside it.
 */
function contiguousRuns(sections: Section[], count: number): Section[][] {
  if (count <= 1 || sections.length <= 1) return [sections];
  const runs = Math.min(count, sections.length);
  const weight = sections.map(depth);
  const total = weight.reduce((sum, w) => sum + w, 0);

  const out: Section[][] = [];
  let start = 0;
  let taken = 0;
  for (let run = 1; run < runs; run++) {
    const target = (total * run) / runs;
    // Every run still to come needs a section of its own left for it.
    const limit = sections.length - (runs - run);
    let cut = start;
    while (cut < limit && (cut === start || taken < target)) taken += weight[cut++];
    out.push(sections.slice(start, cut));
    start = cut;
  }
  out.push(sections.slice(start));
  return out;
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
   * Per language, the body-section index this comparison read up to, exclusive.
   * Absent means the whole article was read and there is nothing to split.
   *
   * It is per language rather than one number because the aligned sections sit
   * at different positions in each edition — the English article can reach the
   * same subject two sections earlier than the Arabic one — so a single cut
   * would fall in the wrong place in two columns out of three.
   */
  processedThrough?: Partial<Record<Lang, number>>;
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
  const [layout, setLayout] = useState<{ sig: string; bands: Band[] }>({ sig: "", bands: [] });
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
      if (layout.bands.length) setLayout({ sig: "", bands: [] });
      return;
    }
    if (layout.sig !== signature) {
      settled.current = "";
      setLayout({ sig: signature, bands: [opening(visible)] });
      return;
    }
    if (settled.current === signature) return;
    // Each pass measures the band the previous pass opened, so the whole
    // sequence resolves in at most one pass per language, before the paint.
    const grown = grow(wrap.current, layout.bands);
    if (grown) setLayout({ sig: signature, bands: grown });
    else settled.current = signature;
  }, [banding, signature, layout, visible]);

  const bands =
    banding && layout.sig === signature && layout.bands.length ? layout.bands : [opening(visible)];

  const bodyOf = (lang: Lang): Section[] => {
    const article = articles[lang];
    if (!article) return [];
    const all = article.sections.filter((s) => s.heading !== KEY_FACTS_HEADING);
    const cut = processedThrough?.[lang] ?? all.length;
    return part === "head" ? all.slice(0, cut) : part === "tail" ? all.slice(cut) : all;
  };

  return (
    <div
      ref={wrap}
      className="columns-flow bg-wiki-page"
      aria-hidden={part === "tail" ? true : undefined}
    >
      {bands.map((band, bandIndex) => {
        const following = bands[bandIndex + 1];
        const closing = bandIndex === bands.length - 1;
        // How many of the original columns' worth of width each column in this
        // band has been handed, which is how many runs it sets its text in.
        const runs = Math.min(
          MAX_RUNS,
          Math.max(1, Math.floor(visible.length / band.langs.length)),
        );
        return (
          <div
            key={bandIndex}
            data-band={bandIndex}
            className={
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
                  "columns columns-faded grid max-cols:block items-stretch [-webkit-mask-image:linear-gradient(to_bottom,black_0,transparent_340px)] [mask-image:linear-gradient(to_bottom,black_0,transparent_340px)] pointer-events-none max-h-[340px] overflow-hidden"
                : bandIndex === 0
                  ? "columns grid max-cols:block items-stretch"
                  : // A rule straight across says the page has changed shape here,
                    // so the columns below it landing out of line with the ones
                    // above reads as deliberate rather than as a broken grid.
                    "columns-more grid max-cols:block items-stretch border-t border-rule"
            }
            style={{ gridTemplateColumns: `repeat(${band.langs.length}, minmax(0, 1fr))` }}
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
              const groups = contiguousRuns(body, runs);
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
                    </div>
                  )}
                  {chrome && (
                    <h1 className="article-title m-0 mb-3.5 pb-2 text-[26px] leading-tight font-wiki-heading font-normal border-b border-wiki-border text-wiki-text">
                      {article.title}
                    </h1>
                  )}
                  {chrome && article.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="article-image block mx-auto object-contain m-0 mb-4 p-1 bg-wiki-page rounded-[2px]"
                      style={{ width: IMAGE_WIDTH, height: IMAGE_HEIGHT }}
                      src={article.image.src}
                      alt={article.image.alt ?? article.title}
                      loading="lazy"
                    />
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
                  {bandIndex > 0 && (
                    // The masthead of a continued column. Without it a band that
                    // has dropped from three columns to one is a wall of text in a
                    // script the reader has to identify for themselves.
                    <div className="column-continues flex items-baseline gap-2.5 pb-2 mb-4 border-b border-wiki-border font-mono text-[11px] tracking-[0.08em] uppercase text-ink-soft">
                      <span className="native font-body text-[15px] normal-case tracking-normal text-ink">
                        {meta.native}
                      </span>
                      <span className="arrow text-[12px] text-ink" aria-hidden="true">
                        {meta.dir === "rtl" ? "←" : "→"}
                      </span>
                      <span>continues</span>
                    </div>
                  )}
                  {groups.length > 1 ? (
                    <div
                      className="runs grid gap-x-[38px]"
                      style={{
                        gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))`,
                      }}
                    >
                      {groups.map((group, i) => (
                        <div key={i} className="run min-w-0">
                          {group.map(block)}
                        </div>
                      ))}
                    </div>
                  ) : (
                    body.map(block)
                  )}
                  {closes && (
                    <div className="column-ends mt-7 pt-2.5 border-t border-wiki-border font-mono text-[11px] tracking-[0.08em] uppercase text-ink-soft">
                      end of the {meta.label} article
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
