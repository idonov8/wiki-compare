"use client";

import { useEffect, useState } from "react";
import { GLOBE_CX, GLOBE_CY, MERIDIAN_RX, PARALLELS, RING_PATH } from "./globe";
import { LANGS, LANG_META, type Lang } from "@/lib/types";

/**
 * The wait is long enough to need filling: an uncached comparison resolves
 * sitelinks, pulls three revisions, parses three articles, diffs their linked
 * concepts and only then reads all three with the model. That last step alone
 * runs tens of seconds, so this draws the thing being assembled — a globe of
 * scripts, with each language feeding into it.
 *
 * It sits at the bottom centre of the viewport, over the articles rather than
 * instead of them: the columns are already on screen and readable while this
 * runs, so the panel stays small, out of the text's way, and click-through.
 */

/** Chip placement and the strand running from it into the globe, hand-placed
 *  against the 320x300 viewBox. Three fixed positions read better here than
 *  anything derived, and the strand endpoints have to meet the sphere exactly. */
const CHIPS: Record<Lang, { x: number; y: number; w: number; strand: string }> = {
  en: { x: 8, y: 30, w: 84, strand: "M 84 58 Q 90 84 112 93" },
  he: { x: 232, y: 30, w: 76, strand: "M 236 58 Q 230 84 208 93" },
  ar: { x: 118, y: 252, w: 84, strand: "M 160 250 Q 150 220 160 194" },
};

/** One glyph per script, sweeping across the sphere's face as it turns. Kept on
 *  well-separated parallels so two scripts never crowd the same patch of globe. */
const GLYPHS: { char: string; y: number; size: number; delay: string }[] = [
  { char: "W", y: 104, size: 19, delay: "0s" },
  { char: "א", y: 136, size: 21, delay: "-3s" },
  { char: "ع", y: 166, size: 20, delay: "-6s" },
];

/** Where each strand meets the sphere. A ring opens at the seam as it lands. */
const LANDINGS: Record<Lang, [x: number, y: number]> = {
  en: [112, 93],
  he: [208, 93],
  ar: [160, 194],
};

// The sphere's own geometry lives in `./globe`, because the landing page draws
// the same sphere at rest.

/**
 * What the route is doing, in the order it does it.
 *
 * These advance on elapsed time, which used to be all there was: the endpoint
 * answered with one JSON body and the client could not know which stage it was
 * in. It streams now, so the two stages that have a real signal behind them —
 * the articles arriving, and the first difference being found — are driven by
 * that signal instead, and the clock only fills the gaps between. An estimate
 * that gets overtaken by the truth is corrected rather than left running.
 */
const STAGES: [afterMs: number, label: string][] = [
  [0, "Resolving the article across languages"],
  [1200, "Fetching the current revisions"],
  [2400, "Parsing English, Hebrew and Arabic"],
  [4200, "Diffing the linked concepts"],
  [6000, "Reading all three for disagreements"],
];

/** The stage the articles landing puts us at, whatever the clock says. */
const READING = 4;

/** Past this, say so rather than leaving a spinner to imply something is stuck. */
const PATIENCE_MS = 20_000;

export default function Loading({
  title,
  /** True once the columns are on screen: the read has reached the model. */
  reading = false,
  /** Differences found so far. Counted up as the model writes them. */
  found = 0,
}: {
  title: string;
  reading?: boolean;
  found?: number;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - started), 250);
    return () => clearInterval(id);
  }, []);

  const guessed = STAGES.filter(([at]) => elapsed >= at).length - 1;
  const stage = reading ? Math.max(guessed, READING) : guessed;

  return (
    // Bottom centre, over the articles rather than in place of them: the columns
    // are already rendered and readable while this runs, so the panel is
    // deliberately pointer-events-none and lets clicks through to them.
    <div
      // Sits above the floating language switch below `cols`: the switch is
      // live while a comparison runs — the articles are already readable and
      // already swipeable — so this panel gives it the bottom of the screen.
      className="loading fixed left-1/2 bottom-3 max-cols:bottom-[76px] z-[45] flex max-w-[min(92vw,460px)] -translate-x-1/2 flex-col items-center gap-0.5 border border-ink rounded-sm bg-paper-veil px-[22px] pt-2 pb-3 pointer-events-none shadow-offset backdrop-blur-[2px]"
      aria-live="off"
    >
      <svg className="globe h-auto w-[152px] max-w-[40vw] overflow-visible" viewBox="0 0 320 300" aria-hidden="true">
        {/* strands: each language flowing into the sphere */}
        {LANGS.map((lang, i) => (
          <path
            key={`strand-${lang}`}
            className="strand fill-none stroke-ink-soft [stroke-width:1.4] [stroke-dasharray:2_7] animate-strand-flow"
            d={CHIPS[lang].strand}
            style={{ animationDelay: `${i * -0.5}s` }}
          />
        ))}

        {/* the sphere, left open at the upper right */}
        <g className="sphere">
          <path className="ring fill-none stroke-ink [stroke-width:1.6]" d={RING_PATH} />
          {PARALLELS.map(([cy, rx, ry], i) => (
            <ellipse
              key={`lat-${i}`}
              className="parallel fill-none stroke-ink-soft [stroke-width:0.9] opacity-50"
              cx={GLOBE_CX}
              cy={cy}
              rx={rx}
              ry={ry}
            />
          ))}
          {/* The sphere turns by squashing each meridian through zero width —
              cheaper than projecting a real rotation, and at this size
              indistinguishable from one. See `./globe` for why the resting rx
              values are staggered rather than all 62. */}
          {MERIDIAN_RX.map((rx, i) => (
            <ellipse
              key={`mer-${i}`}
              className="meridian fill-none stroke-ink-soft [stroke-width:0.9] opacity-50 animate-meridian-turn"
              cx={GLOBE_CX}
              cy={GLOBE_CY}
              rx={rx}
              ry="62"
              style={{ animationDelay: `${i * -3}s` }}
            />
          ))}
          {GLYPHS.map(({ char, y, size, delay }) => (
            // fill-box is load-bearing: an SVG element's transform-origin is the
            // viewport origin by default, so the scale in the sweep pulled every
            // glyph up and to the left towards (0,0) and dropped three scripts
            // on top of each other.
            <text
              key={char}
              className="glyph fill-ink font-body [transform-box:fill-box] origin-center animate-glyph-sweep"
              x="160"
              y={y}
              fontSize={size}
              textAnchor="middle"
              style={{ animationDelay: delay }}
            >
              {char}
            </text>
          ))}
        </g>

        {LANGS.map((lang, i) => (
          <circle
            key={`land-${lang}`}
            className="landing fill-none stroke-ink [stroke-width:1.2] animate-landing-open"
            cx={LANDINGS[lang][0]}
            cy={LANDINGS[lang][1]}
            r="2"
            style={{ animationDelay: `${i * -0.5}s` }}
          />
        ))}

        {/* the last tile, dropping into the gap */}
        <path
          className="tile fill-tile stroke-ink [stroke-width:1.6] [stroke-linejoin:round] animate-tile-settle"
          d="M 183.2 74.5 A 62 62 0 0 1 206.1 90.5 L 197.2 98.5 A 50 50 0 0 0 178.7 85.6 Z"
        />

        {LANGS.map((lang, i) => {
          const chip = CHIPS[lang];
          return (
            <g key={lang} className="chip animate-chip-breathe" style={{ animationDelay: `${i * -0.5}s` }}>
              <rect
                className="fill-paper-raised stroke-ink [stroke-width:1.2]"
                x={chip.x}
                y={chip.y}
                width={chip.w}
                height="28"
                rx="2"
              />
              <text
                className="fill-ink font-body"
                x={chip.x + chip.w / 2}
                y={chip.y + 19}
                textAnchor="middle"
                lang={lang}
                fontSize="14"
              >
                {LANG_META[lang].native}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="loading-text max-w-[44ch] text-center">
        <h2 className="mb-[2px] font-display text-[19px] font-normal">{title}</h2>
        <p className="stage font-mono text-[12px] text-ink-soft" role="status" aria-live="polite">
          {/* Once differences are landing, the count is the more useful thing to
              say: it is the one number that proves the wait is producing
              something, and it is already marked on the page behind this panel. */}
          {found > 0
            ? `${found} difference${found === 1 ? "" : "s"} found so far`
            : STAGES[Math.min(stage, STAGES.length - 1)][1]}
          <span className="ellipsis" aria-hidden="true">
            <i className="inline-block w-1 not-italic animate-ellipsis-fade">.</i>
            <i className="inline-block w-1 not-italic animate-ellipsis-fade [animation-delay:0.5s]">.</i>
            <i className="inline-block w-1 not-italic animate-ellipsis-fade [animation-delay:1s]">.</i>
          </span>
        </p>
        {/* The invitation to race the model only makes sense while it is still
            behind: once its findings are on the page, they are the answer. */}
        {elapsed > PATIENCE_MS && found === 0 && (
          <p className="waited mt-[10px] font-mono text-[11px] text-ink-soft opacity-70">
            All three articles are being processed. <br />
            Can you find the differences first?
          </p>
        )}
      </div>
    </div>
  );
}
