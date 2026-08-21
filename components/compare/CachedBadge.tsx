"use client";

import { relative } from "@/lib/relative";
import { LANG_META, type CacheInfo } from "@/lib/types";

/** Which versions moved, and the offer to replace this answer with one read
 *  from the live text. */
function cacheNote(cache: CacheInfo): string {
  const names = cache.edited.map((l) => LANG_META[l].label);
  const subject =
    names.length === 1
      ? `The ${names[0]} article has`
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} have`;
  return (
    `${subject} been edited on Wikipedia since this comparison was processed ${relative(cache.computedAt)}. ` +
    `Donate to update this page.`
  );
}

/**
 * Shown only when the cached answer and Wikipedia have actually diverged. An
 * exact-revision hit is cached too, but it describes the live text, so badging
 * it would cry wolf on the ordinary case.
 *
 * The panel is not a tooltip and is not labelled as one: it contains the button
 * that keeps the promise its last sentence makes. The note alone describes the
 * badge; the button is a control beside it, reachable by pointer and by Tab.
 * Signed out it goes to the donate page rather than to a 401 — it should never
 * be a dead end for the reader who believed the sentence above it.
 */
export default function CachedBadge({
  cache,
  busy,
  signedIn,
  onUpdate,
  onDonate,
}: {
  cache: CacheInfo;
  busy: boolean;
  signedIn: boolean;
  onUpdate: () => void;
  onDonate: () => void;
}) {
  return (
    <span
      className="cached-badge group relative inline-flex items-center gap-[5px] ms-[9px] max-tight:ms-[6px] px-[7px] py-[2px] max-tight:px-[5px] max-tight:py-[1px] border border-rule bg-paper-raised font-mono text-[10px] max-tight:text-[9px] tracking-[0.09em] uppercase text-ink-soft cursor-default before:content-[''] before:w-[5px] before:h-[5px] before:rounded-full before:bg-framing"
      tabIndex={0}
      aria-describedby="cached-note"
    >
      cached
      {/* The panel is a DOM child of the badge, so `group-hover` /
          `group-focus-within` keep it open while the pointer or focus is
          anywhere inside it — except for the 8px gap between the badge's bottom
          edge and the panel's top edge, where nothing is painted at all.
          Crossing that empty band drops the hover before the pointer ever
          reaches the button, so the `::before` bridge paints 9px over the gap
          (one pixel overlapping the badge, so there is no seam at either end).
          A Playwright test walks the mouse across it in twelve steps.
          `focus-within`, not `focus-visible`, is what lets Tab reach the button.
          Visibility toggles rather than display so the panel can be measured and
          clicked mid-transition, and it takes pointer events only while open. */}
      <span className="cached-tip absolute z-50 top-[calc(100%_+_8px)] end-0 w-[min(300px,calc(100vw_-_36px))] px-[13px] py-[11px] bg-paper-raised border border-ink rounded-[2px] shadow-offset font-body text-[13px] leading-[1.55] tracking-normal normal-case text-start text-ink opacity-0 invisible pointer-events-none transition-opacity duration-[120ms] ease-[ease] grid justify-items-start gap-[10px] group-hover:opacity-100 group-hover:visible group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:visible group-focus-within:pointer-events-auto before:content-[''] before:absolute before:inset-x-0 before:-top-[9px] before:h-[9px]">
        <span id="cached-note">{cacheNote(cache)}</span>
        {/* Filled rather than underlined: it sits directly under a sentence,
            where a link would read as the end of that sentence instead of the
            answer to it. */}
        <button
          className="cached-update px-[11px] py-[5px] max-tight:px-[9px] max-tight:py-[4px] border border-ink rounded-[2px] bg-ink text-paper-raised font-mono text-[11px] max-tight:text-[10px] tracking-[0.07em] uppercase hover:enabled:bg-ink-soft hover:enabled:border-ink-soft disabled:opacity-50 disabled:cursor-progress"
          disabled={busy}
          onClick={signedIn ? onUpdate : onDonate}
        >
          {busy ? "Re-reading…" : "Update this article"}
        </button>
      </span>
    </span>
  );
}
