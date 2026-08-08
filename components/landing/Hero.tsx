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
      {/* The sphere at rest, centred above the headline. It is the same object
          the loading panel turns, which is the point: the reader meets it
          here and recognises it while they wait. The three squares mark the
          site's own palette for disagreement — contradiction, uniqueness,
          framing — so the shape reads as "three tellings, one globe" before
          a word of the headline is read. */}
      <div className="animate-reveal-in flex justify-center pt-[max(5vh,28px)]" style={{ animationDelay: "10ms" }}>
        <GlobeMark />
      </div>

      <Section
        className="relative pt-[max(2vh,16px)] pb-[max(4vh,32px)]"
      >

        <h1
          // Not tighter than 1.05: the marked word carries a band the height of
          // its line box, and at 0.94 that band climbed into the descenders of
          // the line above it.
          className="animate-reveal-in mt-5.5 mb-0 font-display font-normal text-[clamp(40px,7vw,84px)] leading-[1.05] tracking-[-0.02em]"
          style={{ animationDelay: "70ms" }}
        >
          Same article.
          <br />
            <em>Different truth.</em>&nbsp;
          </h1>

        <p
          className="animate-reveal-in mt-5.5 mb-0 max-w-[66ch] text-[16px] leading-[1.65] text-ink-soft"
          style={{ animationDelay: "130ms" }}
        >
          Explore different narratives through Wikipedia articles.
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

      </Section>
    </div>
  );
}

/**
 * The three squares set on the sphere's face, one per kind of difference the
 * rest of the site marks in the same colours (see `--color-contradiction`,
 * `--color-unique`, `--color-framing` in globals.css). Hand-placed on three
 * separate parallels so none sits on another, same spirit as the rest of
 * this file's geometry.
 */
const TILES: { fill: string; x: number; y: number; size: number }[] = [
  { fill: "var(--color-contradiction)", x: 128, y: 100, size: 11 },
  { fill: "var(--color-unique)", x: 178, y: 146, size: 11 },
  { fill: "var(--color-framing)", x: 138, y: 168, size: 11 },
];

/**
 * The sphere, still. No strands, no chip, no glyph sweep — the loading panel
 * earns that motion by having a wait to fill, and repeating it here would put
 * something urgently in progress above a page where nothing is happening.
 */
function GlobeMark() {
  return (
    <svg
      className="pointer-events-none h-auto w-[clamp(150px,26vw,240px)] opacity-90"
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
      {TILES.map(({ fill, x, y, size }, i) => (
        <rect
          key={`tile-${i}`}
          x={x - size / 2}
          y={y - size / 2}
          width={size}
          height={size}
          rx="1.5"
          fill={fill}
        />
      ))}
    </svg>
  );
}
