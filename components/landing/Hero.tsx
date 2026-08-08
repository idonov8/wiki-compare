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
 * Three of the sphere's own grid cells, filled rather than square — one per
 * kind of difference the rest of the site marks in the same colours (see
 * `--color-contradiction`, `--color-unique`, `--color-framing` in
 * globals.css). Each `d` traces the actual parallel and meridian arcs that
 * bound that cell, so the fill is warped by the same curvature as the wires
 * around it rather than sitting on top of them as a flat shape. Computed
 * once against the parallel/meridian ellipses in `./globe` and pasted in
 * here, in the same hand-placed spirit as the rest of this file's geometry.
 */
const TILES: { fill: string; d: string }[] = [
  {
    fill: "var(--color-contradiction)",
    d: "M 103.8 105.82 L 104.15 107.43 L 105.19 109.02 L 106.9 110.58 L 109.25 112.07 L 112.24 113.49 L 115.8 114.82 L 115.59 115.85 L 115.39 116.88 L 115.2 117.93 L 115.03 118.97 L 114.87 120.02 L 114.72 121.07 L 109.78 122.62 L 105.63 124.31 L 102.33 126.12 L 99.94 128.03 L 98.49 130 L 98 132 L 98.16 127.5 L 98.65 123.02 L 99.47 118.59 L 100.6 114.23 L 102.05 109.97 Z",
  },
  {
    fill: "var(--color-unique)",
    d: "M 205.28 121.07 L 202.9 120.45 L 200.39 119.86 L 197.75 119.31 L 195.01 118.79 L 192.16 118.32 L 189.21 117.89 L 189.64 122.48 L 189.91 127.13 L 190 131.81 L 189.92 136.48 L 189.67 141.13 L 189.25 145.73 L 192.06 146.21 L 194.75 146.73 L 197.32 147.28 L 199.76 147.88 L 202.05 148.51 L 204.2 149.18 L 205.04 144.59 L 205.62 139.92 L 205.94 135.21 L 205.99 130.48 Z",
  },
  {
    fill: "var(--color-framing)",
    d: "M 103.8 158.18 L 104.15 156.57 L 105.19 154.98 L 106.9 153.42 L 109.25 151.93 L 112.24 150.51 L 115.8 149.18 L 116.92 153.73 L 118.29 158.14 L 119.91 162.4 L 121.77 166.48 L 123.85 170.35 L 126.16 173.99 L 124.35 174.83 L 122.85 175.7 L 121.67 176.61 L 120.81 177.55 L 120.29 178.5 L 120.1 179.46 L 116.76 176.44 L 113.65 173.18 L 110.79 169.71 L 108.18 166.04 L 105.85 162.19 Z",
  },
];

/**
 * The sphere, still. No strands, no chip, no glyph sweep — the loading panel
 * earns that motion by having a wait to fill, and repeating it here would put
 * something urgently in progress above a page where nothing is happening.
 */
function GlobeMark() {
  return (
    <svg
      className="pointer-events-none h-auto w-[clamp(220px,38vw,360px)]"
      viewBox="0 0 320 300"
      aria-hidden="true"
    >
      {TILES.map(({ fill, d }, i) => (
        <path key={`tile-${i}`} d={d} fill={fill} fillOpacity="0.32" />
      ))}
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
