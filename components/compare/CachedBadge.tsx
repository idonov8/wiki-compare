"use client";

import { relative } from "@/lib/relative";
import { LANG_META, type CacheInfo } from "@/lib/types";

/** Which versions moved since this answer was read. */
function cacheNote(cache: CacheInfo): string {
  const names = cache.edited.map((l) => LANG_META[l].label);
  const subject =
    names.length === 1
      ? `The ${names[0]} article has`
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} have`;
  return `${subject} been edited on Wikipedia since this comparison was processed ${relative(cache.computedAt)}.`;
}

/**
 * Shown only when the cached answer and Wikipedia have actually diverged. An
 * exact-revision hit is cached too, but it describes the live text, so badging
 * it would cry wolf on the ordinary case.
 *
 * The badge is always the last thing in whichever row of the strip it belongs
 * to. That costs a phone no line of its own to say one word, and it is what
 * puts the panel below on screen: hung from a badge that ends its row, it opens
 * inside the page's margins rather than off the edge.
 */
export default function CachedBadge({ cache }: { cache: CacheInfo }) {
  return (
    <span
      className="cached-badge group relative shrink-0 inline-flex items-center gap-[5px] ms-[9px] max-tight:ms-[6px] px-[7px] py-[2px] max-tight:px-[5px] max-tight:py-[1px] border border-rule bg-paper-raised font-mono text-[10px] max-tight:text-[9px] tracking-[0.09em] uppercase text-ink-soft cursor-default before:content-[''] before:w-[5px] before:h-[5px] before:rounded-full before:bg-framing"
      tabIndex={0}
      aria-describedby="cached-note"
    >
      cached
      {/* Hung from the badge's far edge, which is why the badge ending its row
          matters to more than the strip's height: a 300px panel measured back
          from a badge stranded in the middle of a phone starts off the near
          edge of the screen. Ending the row, the badge sits against the page's
          own margin, and the panel — never wider than the page between its
          margins — lands inside it.

          The panel is a DOM child of the badge, so `group-hover` /
          `group-focus-within` keep it open while the pointer or focus is
          anywhere inside it — except for the 8px gap between the badge's bottom
          edge and the panel's top edge, where nothing is painted at all.
          Crossing that empty band drops the hover before the pointer ever
          reaches the panel, so the `::before` bridge paints 9px over the gap
          (one pixel overlapping the badge, so there is no seam at either end).
          A Playwright test walks the mouse across it in twelve steps.
          Visibility toggles rather than display so the panel can be measured
          mid-transition, and it takes pointer events only while open. */}
      <span className="cached-tip absolute z-50 top-[calc(100%_+_8px)] end-0 w-[min(300px,calc(100vw_-_36px))] px-[13px] py-[11px] bg-paper-raised border border-ink rounded-[2px] shadow-offset font-body text-[13px] leading-[1.55] tracking-normal normal-case text-start text-ink opacity-0 invisible pointer-events-none transition-opacity duration-[120ms] ease-[ease] grid justify-items-start gap-[10px] group-hover:opacity-100 group-hover:visible group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:visible group-focus-within:pointer-events-auto before:content-[''] before:absolute before:inset-x-0 before:-top-[9px] before:h-[9px]">
        <span id="cached-note">{cacheNote(cache)}</span>
      </span>
    </span>
  );
}
