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
import { LANGS, LANG_META, type Lang } from "@/lib/types";

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
      <div className="animate-reveal-in pt-[max(2vh,12px)]" style={{ animationDelay: "10ms" }}>
        <GlobeWithLanguages />
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

/**
 * How much bigger Hebrew and Arabic are set than the Latin.
 *
 * Noto Serif Hebrew and Noto Naskh Arabic both run visibly smaller than Noto
 * Serif at the same pixel size. Matching the numbers rather than the apparent
 * size is how two of the three languages end up looking like the junior ones,
 * which is the opposite of what this page is about.
 */
const NATIVE_SIZE: Record<Lang, string> = {
  en: "text-[clamp(15px,1.9vw,18px)]",
  he: "text-[clamp(17px,2.2vw,21px)]",
  ar: "text-[clamp(17px,2.2vw,21px)]",
};

/**
 * One language: its name in its own script, its Wikipedia subdomain beneath.
 *
 * The subdomain is not decoration. `en`, `he` and `ar` are the three
 * Wikipedias a comparison is actually pulled from, which makes it the most
 * literal statement of what this page does — the same slot the language
 * portal at wikipedia.org fills with each edition's article count.
 */
function LanguageMark({ lang, align }: { lang: Lang; align: string }) {
  return (
    <div className={`flex flex-col gap-[1px] ${align}`}>
      <span
        lang={lang}
        dir={LANG_META[lang].dir}
        // A fixed line box rather than a multiple of the font size: the three
        // are set at two different sizes, and a relative leading gave each one
        // a different height, so the codes under them stepped out of line.
        className={`font-body leading-[26px] text-ink ${NATIVE_SIZE[lang]}`}
      >
        {LANG_META[lang].native}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-soft">
        {lang}
      </span>
    </div>
  );
}

/**
 * The globe with the three Wikipedias set around it, after the language portal
 * at wikipedia.org: the sphere in the middle, the editions ringed around it
 * rather than listed under it.
 *
 * A grid rather than absolute polar positioning. The ring only has three points
 * on it, and three points placed by `left`/`top` percentages have to be re-tuned
 * every time the type or the globe changes size — a grid puts them beside and
 * below by construction and cannot drift or collide. English and Hebrew are
 * centred against the sphere's middle and Arabic sits under it, which is the
 * same triangle `Loading` arranges its chips in.
 *
 * The inner edges align towards the globe — English ends at it, Hebrew starts
 * at it — so the three read as facing the sphere rather than as a column of
 * left-aligned labels that happens to have a picture in it.
 *
 * They are left as type. `Loading` earns its chips and strands by having a wait
 * to fill; nothing is in progress here, and a second moving thing this close to
 * the globe would be two things competing rather than one carrying.
 */
function GlobeWithLanguages() {
  return (
    <div className="mx-auto grid w-fit grid-cols-[auto_auto_auto] items-center justify-center gap-x-[clamp(10px,2.6vw,26px)]">
      <LanguageMark lang="en" align="items-end text-end" />
      <div className="flex justify-center">
        <GlobeMark />
      </div>
      <LanguageMark lang="he" align="items-start text-start" />
      {/* Same measure as the column gap, so the three sit at an equal distance
          from the sphere rather than the one underneath tucking in closer. */}
      <div className="col-span-3 flex justify-center pt-[clamp(10px,2.6vw,26px)]">
        <LanguageMark lang="ar" align="items-center text-center" />
      </div>
    </div>
  );
}

/** How long the sphere takes to come back round, and the angle it is caught at
 *  before it starts — 0° puts a meridian exactly edge-on, which is a thin frame
 *  to be stuck on if motion is off.
 *
 *  A full minute-plus per turn, because this sits directly above the headline
 *  and anything quicker competes with the words for attention: at 26s the eye
 *  kept being pulled back to it. The globe wants to be something noticed on a
 *  second look, not motion at the edge of vision while somebody is reading. */
const SPIN_SECONDS = 68;
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
 *  goes again. Set so that a handful of the forty-eight are showing at once —
 *  it is the count on screen that matters, so it rose when every square of the
 *  grid became a candidate rather than half of them. */
const CELL_FILL = 0.34;
const CELL_GATE = 0.85;

/** A stable [0,1) from an integer. Deterministic on purpose: this renders on
 *  the server too, and `Math.random()` here would mean the markup React
 *  hydrates against never matches the one it was sent. */
function scatter(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const FILLS = [
  "var(--color-contradiction)",
  "var(--color-unique)",
  "var(--color-framing)",
];

/**
 * The three colours dealt out sixteen each, then shuffled.
 *
 * Taking `FILLS[hash % 3]` per cell looked like the obvious thing and gave
 * 7/20/21 — a hash is uniform in the limit and forty-eight is not the limit,
 * and one of the three kinds of difference being a third as common as another
 * is visible. Dealing a balanced hand and shuffling it keeps the counts exact.
 * Shuffled rather than laid down in order because `k % 3` over a grid eight
 * wide is itself a diagonal stripe, which is the mistake this file already
 * made once.
 */
const CELL_FILLS = (() => {
  const deck = Array.from({ length: 48 }, (_, i) => FILLS[i % FILLS.length]);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(scatter(i) * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
})();

/**
 * Every cell of the grid is a candidate: six bands by eight lunes.
 *
 * This used to pick twenty-four of the forty-eight on a stride — slot =
 * band + 2·j — which is a lattice, and a lattice is the one thing the eye is
 * unfailingly good at. It locked slot parity to band parity, so half the grid
 * could never light at all and a cell's neighbour in the band below was always
 * exactly one lune over: any two showing at once stepped diagonally, and the
 * whole thing read as a pattern rather than as weather. Every square can light
 * now, and the only thing that varies is when.
 *
 * The clocks come from a hash of the position for the same reason. Anything
 * that walks the grid in order — a golden-ratio stride over the index, which is
 * what was here before — leaves a gradient across it, and a gradient in phase
 * is a wave rolling over the sphere. A hash gives neighbours unrelated clocks.
 *
 * Periods sit between 35s and 95s, either side of the 68s turn and none of them
 * a multiple of it. A cell that comes and goes faster than the surface it is
 * painted on reads as blinking rather than as turning.
 */
const CELLS = BANDS.flatMap((_, band) =>
  Array.from({ length: 8 }, (_, slot) => {
    const k = band * 8 + slot;
    return {
      band,
      lon: HALF_LUNE + 45 * slot,
      fill: CELL_FILLS[k],
      period: 35 + scatter(3 * k + 2) * 60,
      phase: scatter(3 * k + 3),
    };
  }),
);

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
      className="pointer-events-none h-auto w-[clamp(170px,33vw,336px)]"
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
