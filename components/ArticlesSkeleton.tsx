import { LANG_META, LANGS, type Lang } from "@/lib/types";

/**
 * The page, before there is anything to put on it.
 *
 * `/api/articles` answers in about a second, and until it does the page holds
 * only the masthead and the loading panel floating at the foot of an empty
 * screen — so the one moment the reader is told the least is the moment they
 * are waiting hardest to see whether they picked the right subject. This draws
 * the shape of the answer in the meantime: the control strip and three ruled
 * columns on the Wikipedia surface, each headed by the edition it is waiting
 * for.
 *
 * The parts that are real rather than barred are the parts already known —
 * which editions are being read, in their own scripts, and what the legend and
 * the run's progress line say before a run has read anything. Everything that
 * waits on the fetch — how long each edition runs, its title, its facts, its
 * body — is a bar.
 */

/** Same box every lead photo renders in over in `Columns`, so a column that
 *  turns out to have one does not jump when it arrives. A column that turns
 *  out to have none shortens by exactly this much instead — there is no
 *  reserving for both, and an article page without a picture in the corner
 *  does not read as an article page. */
const IMAGE_WIDTH = 300;
const IMAGE_HEIGHT = 260;

/**
 * A column's shape: a lead, then two headed sections.
 *
 * The ragged right edge is written down rather than generated, so the server
 * render and the client's first render agree on it — a placeholder that
 * re-flows under itself on hydration is worse than no placeholder.
 */
const BLOCKS: { heading: boolean; lines: number[] }[] = [
  { heading: false, lines: [100, 97, 100, 93, 100, 68] },
  { heading: true, lines: [100, 95, 100, 99, 84] },
  { heading: true, lines: [98, 100, 91, 100, 96, 57] },
];

/** The three kinds of difference, in the strip's own colours — see `Legend`.
 *  None of this waits on the fetch, so it is drawn for real rather than
 *  barred, the same way the legend above a live comparison is. */
const LEGEND: { swatch: string; label: string }[] = [
  { swatch: "bg-mark-contradiction inset-shadow-contradiction", label: "contradiction" },
  { swatch: "bg-mark-unique inset-shadow-unique", label: "only in one version" },
  { swatch: "bg-mark-framing inset-shadow-framing", label: "different framing" },
];

/** The one bar every piece of this is made of. `chip-breathe` is the pulse the
 *  ledger's skeleton already uses, so the two loading states on the site read
 *  as the same thing happening. */
const BAR = "rounded-[2px] bg-ink-wash-strong animate-chip-breathe";

/**
 * `LangBars`, before any article has said how long it is.
 *
 * The chart always offers all three editions — which of them this subject
 * actually has is itself part of what the fetch answers — so it is drawn from
 * `LANGS` rather than from the columns this page happens to be rendering.
 * Only the code under each bar is real; the bar itself stands for a word count
 * nobody has taken yet.
 */
function LangBarsSkeleton() {
  return (
    <div className="langbars-key max-tight:flex-1 max-tight:basis-0">
      <div className="toggles flex">
        {LANGS.map((lang, index) => (
          <span key={lang} className="toggle flex w-[44px] flex-col items-center max-tight:flex-1">
            <span className="relative flex w-full items-end justify-center" style={{ height: 40 }}>
              <span
                className={`${BAR} w-[22px] max-tight:w-[28px]`}
                style={{ height: 13, animationDelay: `${index * -0.3}s` }}
              />
            </span>
            <span className="h-[2px] w-full border-t border-rule" />
            <span className="mt-[4px] border border-rule px-[7px] py-[3px] font-mono text-[11px] leading-none text-ink-soft">
              {lang.toUpperCase()}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The strip above the columns, drawn in the order the real one mounts in.
 *
 * The legend and the run's opening line are printed for real: three kinds of
 * difference and a run that has read nothing yet are true before the fetch
 * lands, not after. Only the length chart is a guess, because how long each
 * edition runs is exactly what the fetch is for.
 */
function ControlStripSkeleton() {
  return (
    <div
      className="controls border-b border-rule px-[24px] py-[12px] max-tight:px-[18px] max-tight:py-[10px] flex gap-x-[28px] gap-y-[20px] max-cols:gap-x-[16px] max-cols:gap-y-[10px] items-center flex-wrap font-mono text-[12px]"
      aria-hidden="true"
    >
      <LangBarsSkeleton />
      <div className="legend-key flex flex-wrap gap-[16px] max-cols:gap-x-[12px] max-cols:gap-y-[6px] max-tight:min-w-fit max-tight:flex-1 max-tight:basis-0 max-tight:flex-col max-tight:flex-nowrap max-tight:gap-y-[8px] text-ink">
        {LEGEND.map(({ swatch, label }) => (
          <span key={label} className="flex items-center gap-[6px]">
            <i className={`inline-block w-[15px] h-[15px] rounded-[2px] ${swatch}`} />
            {label}
          </span>
        ))}
      </div>
      <span className="inline-flex grow items-center border-b border-rule pb-[4px]">
        <span className="h-[7px] w-full bg-ink-wash" />
      </span>
      <span className="ml-auto text-ink-soft">reading all three…</span>
    </div>
  );
}

export default function ArticlesSkeleton({ langs }: { langs: Lang[] }) {
  return (
    <>
      <ControlStripSkeleton />
      <div
        className="columns-skeleton grid max-cols:block items-stretch bg-wiki-page"
        style={{ gridTemplateColumns: `repeat(${langs.length}, minmax(0, 1fr))` }}
        aria-hidden="true"
      >
        {langs.map((lang, i) => {
          const meta = LANG_META[lang];
          // The three columns pulse out of step, so the page reads as three
          // articles being fetched rather than as one widget blinking.
          const pulse = { animationDelay: `${i * -0.3}s` };
          return (
            <section
              key={lang}
              // Deliberately not `section.column`: this is scenery, and the
              // layout checks that count columns and read their marks should
              // never find it standing in for an article.
              className="skeleton-column min-w-0 pt-[22px] px-[26px] pb-20 max-tight:px-[17px] max-cols:pb-10 border-rule border-l first:border-l-0 max-cols:border-l-0 max-cols:border-t max-cols:first:border-t-0"
              dir={meta.dir}
              lang={lang}
            >
              <div className="flex items-baseline gap-2.5 pb-2.5 mb-4 border-b-2 border-ink font-mono text-[12px]">
                <span className="font-body text-[17px] text-ink">{meta.native}</span>
                <span className="text-[13px] text-ink">{meta.dir === "rtl" ? "←" : "→"}</span>
                {/* The revision number, which is exactly what is being fetched. */}
                <span className={`${BAR} text-transparent`} style={pulse}>
                  rev 0000000
                </span>
                {/* The licence the text below will be under. Always the same
                    link regardless of the article, so — like the native name
                    and the arrow beside it — it is real rather than barred. */}
                <a
                  href="https://creativecommons.org/licenses/by-sa/4.0/"
                  target="_blank"
                  rel="license noreferrer"
                  className="ms-auto text-wiki-link no-underline hover:underline"
                >
                  CC BY-SA 4.0
                </a>
              </div>

              {/* Real type held invisible, the same trick the ledger's skeleton
                  uses: the glyphs still set the line's height, so the bar behind
                  them is the size of the heading it is standing in for rather
                  than a guess at it. */}
              <h2 className="m-0 mb-3.5 pb-2 text-[26px] leading-tight font-wiki-heading font-normal border-b border-wiki-border">
                <span className={`${BAR} inline-block w-[72%] text-transparent`} style={pulse}>
                  Title
                </span>
              </h2>

              <div
                className={`${BAR} mx-auto mb-4`}
                style={{ ...pulse, width: IMAGE_WIDTH, height: IMAGE_HEIGHT, maxWidth: "100%" }}
              />

              <div className="mb-5 border border-wiki-border rounded-[2px] bg-wiki-shade">
                <div className="py-2 px-3 font-mono text-[11px] tracking-[0.09em] uppercase">
                  <span className={`${BAR} inline-block w-[92px] text-transparent`} style={pulse}>
                    Key facts
                  </span>
                </div>
              </div>

              {BLOCKS.map((block, b) => (
                <div key={b}>
                  {block.heading && (
                    <div className="mt-[26px] mb-2 pb-[5px] font-wiki-heading text-[21px] border-b border-wiki-border">
                      <span className={`${BAR} inline-block w-[44%] text-transparent`} style={pulse}>
                        Section
                      </span>
                    </div>
                  )}
                  {/* A bar an em tall with the rest of the leading split either
                      side of it, so a paragraph of these stands exactly as many
                      pixels as the paragraph it is waiting for. */}
                  <div className="font-wiki text-[14.5px] leading-[1.62]">
                    {block.lines.map((width, l) => (
                      <span
                        key={l}
                        className={`${BAR} block h-[1em] my-[0.31em]`}
                        style={{ width: `${width}%`, animationDelay: `${(i * 3 + b + l) * -0.3}s` }}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
