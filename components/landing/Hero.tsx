"use client";

import Section from "./Section";
import SearchBox from "../SearchBox";
import { GLOBE_CX, GLOBE_CY, MERIDIAN_RX, PARALLELS, RING_PATH } from "../globe";
import { LANGS, LANG_META } from "@/lib/types";

/**
 * Articles worth opening from a standing start.
 *
 * Chosen for the divergence rather than for the traffic: a reader who tries one
 * of these and finds three versions that agree has been shown nothing, and will
 * not try a second. Keep this list to subjects the three Wikipedias are known to
 * tell differently — and ideally to ones already cached, so the first thing a
 * visitor does is instant and free.
 */
const TRY = ["Jerusalem", "Hummus", "Palestinian Legislative Council", "Coffee"];

interface Props {
  query: string;
  setQuery: (value: string) => void;
  onSearch: () => void;
  onPick: (title: string) => void;
  busy: boolean;
  /** Sits directly under the search field; `Landing` watches it to know when
   *  the masthead has to grow a search box of its own. */
  sentinel: React.RefObject<HTMLDivElement | null>;
}

export default function Hero({ query, setQuery, onSearch, onPick, busy, sentinel }: Props) {
  return (
    <div className="relative">
      {/* The sphere at rest, bled off the right edge and set well behind the
          type. It is the same object the loading panel turns, which is the
          point: the reader meets it here and recognises it while they wait. */}
      <GlobeMark />

      <Section
        numeral="I."
        className="relative pt-[max(7vh,44px)] pb-[max(4vh,32px)]"
      >
        <p
          className="animate-reveal-in m-0 flex items-center gap-[10px] font-mono text-[12px] tracking-[0.18em] uppercase text-ink-soft"
          style={{ animationDelay: "0ms" }}
        >
          {LANGS.map((lang, i) => (
            <span key={lang} className="flex items-center gap-[10px]">
              {i > 0 && (
                <span aria-hidden="true" className="text-rule">
                  ·
                </span>
              )}
              <span
                className="animate-chip-breathe"
                style={{ animationDelay: `${i * -0.6}s` }}
                lang={lang}
                title={LANG_META[lang].label}
              >
                {lang}
              </span>
            </span>
          ))}
          <span aria-hidden="true" className="ms-[6px] h-px flex-1 bg-rule" />
        </p>

        <h1
          // Not tighter than 1.05: the marked word carries a band the height of
          // its line box, and at 0.94 that band climbed into the descenders of
          // the line above it.
          className="animate-reveal-in mt-[22px] mb-0 font-display font-normal text-[clamp(40px,7vw,84px)] leading-[1.05] tracking-[-0.02em]"
          style={{ animationDelay: "70ms" }}
        >
          Same article.
          <br />
          {/* The band is the site's own vocabulary turned on itself: the word
              three versions would disagree about is marked exactly the way a
              disagreement gets marked inside an article. */}
          <span className="box-decoration-clone bg-mark-contradiction inset-shadow-contradiction px-[0.1em]">
            Different
          </span>{" "}
          information.
        </h1>

        <p
          className="animate-reveal-in mt-[22px] mb-0 max-w-[46ch] text-[16px] leading-[1.65] text-ink-soft"
          style={{ animationDelay: "130ms" }}
        >
          Read the English, Hebrew and Arabic Wikipedia on one subject side by side, with
          every contradiction, omission and difference of framing marked.{" "}
          <b className="font-semibold text-ink">You&rsquo;d be surprised how often it happens.</b>
        </p>

        <div className="animate-reveal-in mt-[32px]" style={{ animationDelay: "190ms" }}>
          <SearchBox
            variant="hero"
            value={query}
            onChange={setQuery}
            onSubmit={onSearch}
            busy={busy}
            id="hero-search"
          />
        </div>
        <div ref={sentinel} aria-hidden="true" className="h-px" />

        <div
          className="animate-reveal-in mt-[18px] flex flex-wrap items-center gap-[8px] font-mono text-[12px] text-ink-soft"
          style={{ animationDelay: "250ms" }}
        >
          <span className="tracking-[0.14em] uppercase">Try</span>
          {TRY.map((title) => (
            <button
              key={title}
              type="button"
              className="border border-rule bg-transparent px-[10px] py-[4px] font-mono text-[12px] text-ink-soft transition-colors duration-[120ms] hover:border-ink hover:bg-ink hover:text-paper-raised"
              onClick={() => onPick(title)}
            >
              {title}
            </button>
          ))}
        </div>

        <p
          className="animate-reveal-in mt-[max(5vh,40px)] mb-0 font-mono text-[11px] tracking-[0.16em] uppercase text-ink-soft"
          style={{ animationDelay: "330ms" }}
          aria-hidden="true"
        >
          ↓&nbsp;&nbsp;See one
        </p>
      </Section>
    </div>
  );
}

/**
 * The sphere, still. No strands, no chips, no glyph sweep — the loading panel
 * earns that motion by having a wait to fill, and repeating it here would put
 * something urgently in progress behind a page where nothing is happening.
 */
function GlobeMark() {
  return (
    <svg
      className="pointer-events-none absolute end-[-110px] top-[4vh] hidden h-auto w-[520px] opacity-[0.15] cols:block"
      viewBox="0 0 320 300"
      aria-hidden="true"
    >
      <path className="fill-none stroke-ink [stroke-width:1.6]" d={RING_PATH} />
      {PARALLELS.map(([cy, rx, ry], i) => (
        <ellipse
          key={`lat-${i}`}
          className="fill-none stroke-ink-soft [stroke-width:0.9]"
          cx={GLOBE_CX}
          cy={cy}
          rx={rx}
          ry={ry}
        />
      ))}
      {MERIDIAN_RX.map((rx, i) => (
        <ellipse
          key={`mer-${i}`}
          className="fill-none stroke-ink-soft [stroke-width:0.9]"
          cx={GLOBE_CX}
          cy={GLOBE_CY}
          rx={rx}
          ry="62"
        />
      ))}
    </svg>
  );
}
