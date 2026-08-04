"use client";

import { useEffect, useState } from "react";
import { LANGS, LANG_META, type Lang } from "@/lib/types";

/**
 * The wait is long enough to need filling: an uncached comparison resolves
 * sitelinks, pulls three revisions, parses three articles, diffs their linked
 * concepts and only then reads all three with the model. That last step alone
 * runs tens of seconds, so this draws the thing being assembled — a globe of
 * scripts, with each language feeding into it.
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

/** Latitude rings: cy/rx/ry for the sphere's parallels, flattened by 0.26 for
 *  perspective. The meridians are ellipses whose rx the stylesheet animates. */
const PARALLELS: [cy: number, rx: number, ry: number][] = [
  [132, 62, 16],
  [105.8, 56.2, 14.6],
  [158.2, 56.2, 14.6],
  [84.5, 39.9, 10.4],
  [179.5, 39.9, 10.4],
  [73, 19.2, 5],
  [191, 19.2, 5],
];

/**
 * What the route is doing, in the order it does it. The endpoint answers with a
 * single JSON body rather than a progress stream, so these advance on elapsed
 * time: the order is real, the moment each one starts is an estimate. The last
 * stage holds until the response actually arrives.
 */
const STAGES: [afterMs: number, label: string][] = [
  [0, "Resolving the article across languages"],
  [1200, "Fetching the current revisions"],
  [2400, "Parsing English, Hebrew and Arabic"],
  [4200, "Diffing the linked concepts"],
  [6000, "Reading all three for disagreements"],
];

/** Past this, say so rather than leaving a spinner to imply something is stuck. */
const PATIENCE_MS = 20_000;

export default function Loading({ title }: { title: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - started), 250);
    return () => clearInterval(id);
  }, []);

  const stage = STAGES.filter(([at]) => elapsed >= at).length - 1;

  return (
    <div className="loading">
      <svg className="globe" viewBox="0 0 320 300" aria-hidden="true">
        {/* strands: each language flowing into the sphere */}
        {LANGS.map((lang, i) => (
          <path
            key={`strand-${lang}`}
            className="strand"
            d={CHIPS[lang].strand}
            style={{ animationDelay: `${i * -0.5}s` }}
          />
        ))}

        {/* the sphere, left open at the upper right */}
        <g className="sphere">
          <path className="ring" d="M 206.1 90.5 A 62 62 0 1 1 183.2 74.5" />
          {PARALLELS.map(([cy, rx, ry], i) => (
            <ellipse key={`lat-${i}`} className="parallel" cx="160" cy={cy} rx={rx} ry={ry} />
          ))}
          {/* The stylesheet animates rx, but the attribute still has to hold a
              staggered value: with motion turned off these are all that is
              left, and four identical circles would not read as a globe. */}
          {[62, 46, 30, 14].map((rx, i) => (
            <ellipse
              key={`mer-${i}`}
              className="meridian"
              cx="160"
              cy="132"
              rx={rx}
              ry="62"
              style={{ animationDelay: `${i * -3}s` }}
            />
          ))}
          {GLYPHS.map(({ char, y, size, delay }) => (
            <text
              key={char}
              className="glyph"
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
            className="landing"
            cx={LANDINGS[lang][0]}
            cy={LANDINGS[lang][1]}
            r="2"
            style={{ animationDelay: `${i * -0.5}s` }}
          />
        ))}

        {/* the last tile, dropping into the gap */}
        <path
          className="tile"
          d="M 183.2 74.5 A 62 62 0 0 1 206.1 90.5 L 197.2 98.5 A 50 50 0 0 0 178.7 85.6 Z"
        />

        {LANGS.map((lang, i) => {
          const chip = CHIPS[lang];
          return (
            <g key={lang} className="chip" style={{ animationDelay: `${i * -0.5}s` }}>
              <rect x={chip.x} y={chip.y} width={chip.w} height="28" rx="2" />
              <text
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

      <div className="loading-text">
        <h2>{title}</h2>
        <p className="stage" role="status" aria-live="polite">
          {STAGES[Math.min(stage, STAGES.length - 1)][1]}
          <span className="ellipsis" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </p>
        <p className="waited">
          {Math.floor(elapsed / 1000)}s
          {elapsed > PATIENCE_MS &&
            " · no cached comparison for these revisions, so all three are being read from scratch"}
        </p>
      </div>
    </div>
  );
}
