"use client";

import { useEffect, useRef } from "react";
import Section from "./Section";
import SearchBox from "../SearchBox";
import {
  GLOBE_CX,
  LATITUDES,
  MERIDIAN_LON,
  PARALLELS,
  RING_PATH,
  cellPath,
  meridianPath,
  normaliseLon,
} from "../globe";
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
      {/* The sphere, centred above the headline and turning on its own —
          idly, the way something sitting on a desk turns, not the way the
          loading panel's does when it has a wait to fill. It is the same
          object that panel turns, which is the point: the reader meets it
          here and recognises it later. Cells light up across the grid as it
          goes, in the site's own three colours for disagreement, so the
          shape reads as somewhere with a great many tellings in it before a
          word of the headline is read. */}
      <div className="animate-reveal-in flex justify-center pt-[max(2vh,12px)]" style={{ animationDelay: "10ms" }}>
        <GlobeMark />
      </div>

      <Section
        className="relative pt-[max(1vh,8px)] pb-[max(4vh,32px)]"
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
          Explore differences in narratives through Wikipedia articles.
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

/** How long the sphere takes to come back round, and the angle it is caught at
 *  before it starts — 0° puts a meridian exactly edge-on, which is a thin frame
 *  to be stuck on if motion is off. */
const SPIN_SECONDS = 26;
const SPIN_START = 18;

/** The six bands between the seven parallels, as [top, bottom] latitudes. */
const BANDS: [top: number, bottom: number][] = LATITUDES.slice(0, -1).map(
  (top, i) => [top, LATITUDES[i + 1]],
);

/** Half a cell's width. Four meridians cut the sphere into eight 45° lunes, so
 *  a cell is one lune wide and centred on `lon`. */
const HALF_LUNE = 22.5;

/** The strongest a cell ever tints, and how much of its cycle it spends at
 *  nothing at all. A plain sine spends most of its time part-way up, which put
 *  a wash of half-there colour over the whole sphere; the gate throws away
 *  everything below `CELL_GATE` so a cell is properly absent, arrives, and
 *  goes again — three or four showing out of twenty-four rather than all of
 *  them faintly. */
const CELL_FILL = 0.34;
const CELL_GATE = 0.5;

/**
 * The cells that take a colour: four in each of the six bands, stepped two
 * lunes along at a time so they spiral round the sphere rather than stacking
 * into a column, and so no band lights where the one above it did.
 *
 * `period` and `phase` are deliberately all different and mostly coprime: what
 * should read is that the globe keeps offering up somewhere new, not that three
 * fixed patches are blinking. Fixed rather than random because this renders on
 * the server too, and a `Math.random()` here would mean the markup React
 * hydrates against never matches the one it sent.
 */
const CELLS: {
  band: number;
  lon: number;
  fill: string;
  period: number;
  phase: number;
}[] = [
  { band: 0, lon: 22.5, fill: "var(--color-contradiction)", period: 17, phase: 0.00 },
  { band: 0, lon: 112.5, fill: "var(--color-unique)", period: 23, phase: 0.38 },
  { band: 0, lon: -157.5, fill: "var(--color-framing)", period: 29, phase: 0.76 },
  { band: 0, lon: -67.5, fill: "var(--color-contradiction)", period: 19, phase: 0.15 },
  { band: 1, lon: 67.5, fill: "var(--color-unique)", period: 26, phase: 0.53 },
  { band: 1, lon: 157.5, fill: "var(--color-framing)", period: 22, phase: 0.91 },
  { band: 1, lon: -112.5, fill: "var(--color-contradiction)", period: 31, phase: 0.29 },
  { band: 1, lon: -22.5, fill: "var(--color-unique)", period: 14, phase: 0.67 },
  { band: 2, lon: 112.5, fill: "var(--color-framing)", period: 27, phase: 0.06 },
  { band: 2, lon: -157.5, fill: "var(--color-contradiction)", period: 21, phase: 0.44 },
  { band: 2, lon: -67.5, fill: "var(--color-unique)", period: 33, phase: 0.82 },
  { band: 2, lon: 22.5, fill: "var(--color-framing)", period: 16, phase: 0.20 },
  { band: 3, lon: 157.5, fill: "var(--color-contradiction)", period: 24, phase: 0.58 },
  { band: 3, lon: -112.5, fill: "var(--color-unique)", period: 18, phase: 0.96 },
  { band: 3, lon: -22.5, fill: "var(--color-framing)", period: 30, phase: 0.35 },
  { band: 3, lon: 67.5, fill: "var(--color-contradiction)", period: 25, phase: 0.73 },
  { band: 4, lon: -157.5, fill: "var(--color-unique)", period: 32, phase: 0.11 },
  { band: 4, lon: -67.5, fill: "var(--color-framing)", period: 20, phase: 0.49 },
  { band: 4, lon: 22.5, fill: "var(--color-contradiction)", period: 28, phase: 0.87 },
  { band: 4, lon: 112.5, fill: "var(--color-unique)", period: 15, phase: 0.26 },
  { band: 5, lon: -112.5, fill: "var(--color-framing)", period: 34, phase: 0.64 },
  { band: 5, lon: -22.5, fill: "var(--color-contradiction)", period: 36, phase: 0.02 },
  { band: 5, lon: 67.5, fill: "var(--color-unique)", period: 13, phase: 0.40 },
  { band: 5, lon: 157.5, fill: "var(--color-framing)", period: 35, phase: 0.78 },
];

/** How far round the sphere has turned, `t` seconds in. */
const spinAt = (t: number) => SPIN_START + (t * 360) / SPIN_SECONDS;

/** One cell at one moment: where it has got to, and how strongly it is showing.
 *  Used for the first frame at render and for every frame after. */
function cellAt(cell: (typeof CELLS)[number], t: number) {
  const [top, bottom] = BANDS[cell.band];
  const centre = normaliseLon(cell.lon + spinAt(t));
  const wave = 0.5 - 0.5 * Math.cos(2 * Math.PI * (t / cell.period + cell.phase));
  const open = Math.max(0, (wave - CELL_GATE) / (1 - CELL_GATE));
  return {
    d: cellPath(top, bottom, centre - HALF_LUNE, centre + HALF_LUNE),
    // Smoothstep, so a cell eases in and out rather than snapping at the gate.
    opacity: (CELL_FILL * open * open * (3 - 2 * open)).toFixed(3),
  };
}

/**
 * The sphere, turning, with cells lighting up across it.
 *
 * The wireframe is untouched — the outline and the seven parallels are the
 * limb and the latitude rings, and neither of those moves when a globe spins
 * about its own axis. Only the meridians travel, and they travel by longitude
 * rather than by the `meridian-turn` keyframe `Loading` uses, because the cells
 * have to sit *between* meridians: two clocks would let a colour drift off its
 * own grid lines within a minute. One angle drives everything instead.
 */
function GlobeMark() {
  const cells = useRef<(SVGPathElement | null)[]>([]);
  const meridians = useRef<(SVGPathElement | null)[]>([]);

  useEffect(() => {
    // The site turns all of its motion off with one media query, and this is
    // the only piece not made of CSS animations for that switch to reach.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const started = performance.now();

    const draw = (now: number) => {
      const t = (now - started) / 1000;

      CELLS.forEach((cell, i) => {
        const el = cells.current[i];
        if (!el) return;
        const { d, opacity } = cellAt(cell, t);
        el.setAttribute("d", d);
        el.setAttribute("fill-opacity", opacity);
      });

      MERIDIAN_LON.forEach((lon, i) => {
        meridians.current[i]?.setAttribute("d", meridianPath(lon + spinAt(t)));
      });

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <svg
      className="pointer-events-none h-auto w-[clamp(220px,38vw,360px)]"
      viewBox="92 64 136 136"
      aria-hidden="true"
    >
      {/* Under the wireframe: a cell is a patch of the surface, so the grid it
          is bounded by has to stay drawn over the top of it. */}
      {CELLS.map((cell, i) => {
        const { d, opacity } = cellAt(cell, 0);
        return (
          <path
            key={`cell-${i}`}
            ref={(el) => {
              cells.current[i] = el;
            }}
            d={d}
            fill={cell.fill}
            fillOpacity={opacity}
          />
        );
      })}

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

      {MERIDIAN_LON.map((lon, i) => (
        <path
          key={`mer-${i}`}
          ref={(el) => {
            meridians.current[i] = el;
          }}
          className="fill-none stroke-ink-soft [stroke-width:0.9]"
          d={meridianPath(lon + spinAt(0))}
        />
      ))}
    </svg>
  );
}
