"use client";

import { useEffect, useState } from "react";
import Section from "./Section";
import { LANG_META, type RecentArticle } from "@/lib/types";

interface Props {
  recent: RecentArticle[];
  onOpen: (title: string, lang: string) => void;
  /** "3 hours ago" — the formatter already used in the meta strip, passed in
   *  rather than duplicated. */
  relative: (iso: string) => string;
  /** True until the first `/api/recent` response lands. Renders a skeleton
   *  built from real rows with their text hidden, so it takes on exactly the
   *  height the ledger is about to have and nothing moves when the fetch
   *  resolves. */
  loading: boolean;
}

/** Rows to skeleton while the real list is in flight. The list itself is
 *  unbounded, so this is not a count of what is coming — it is enough rows to
 *  fill the scroll box, which is all the reader can see either way. */
const SKELETON_ROWS = Array.from({ length: 12 }, (_, i) => i);

/**
 * Articles somebody has already paid to have read.
 *
 * Every cached subject is here, not a recent handful: this is the record of
 * what the site has read, and an article dropping off it because eleven newer
 * ones arrived would make the ledger quietly wrong. What that costs is height,
 * so the rows scroll within a box rather than pushing the footer down a page at
 * a time.
 *
 * Kept as a list rather than as cards on purpose: it is a ledger, not a
 * gallery.
 */
export default function RecentList({ recent, onOpen, relative, loading }: Props) {
  // A link into the ledger can ask for the full-only filter up front, e.g.
  // `/?full=true#recently-compared` from the preview gate. `window` isn't
  // there yet during server prerendering, so the initial state stays `false`
  // and this only runs once the component is mounted in the browser.
  const [fullOnly, setFullOnly] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("full") === "true") {
      setFullOnly(true);
    }
  }, []);

  if (!loading && !recent.length) return null;

  const shown = fullOnly ? recent.filter((item) => item.scope === "full") : recent;

  return (
    <Section
      heading="Recently compared:"
      className="py-[max(7vh,52px)]"
      id="recently-compared"
      action={
        !loading && (
          <div className="flex shrink-0 items-baseline gap-[12px]">
            {/* The box only ever shows ten or so rows, and it can land on a row
                boundary and read as the whole list. The count is what says
                otherwise, and while the filter is on it says what was hidden. */}
            <span className="font-mono text-[11px] tracking-[0.04em] text-ink-soft" aria-live="polite">
              {fullOnly ? `${shown.length} of ${recent.length}` : `${recent.length} articles`}
            </span>
            <button
              type="button"
              className="recent-filter border border-rule px-[10px] py-[5px] font-mono text-[11px] tracking-[0.09em] uppercase text-ink-soft hover:bg-paper-raised aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper-raised"
              aria-pressed={fullOnly}
              onClick={() => setFullOnly((on) => !on)}
            >
              Full only
            </button>
          </div>
        )
      }
    >
      {/* The rules and the scrolling live on the same box, so both lines stay
          put while the rows travel between them — a row cut off at the bottom
          edge then reads as more of the ledger below, not as the end of it. */}
      <div className="mt-[26px] max-h-[min(62vh,520px)] overflow-y-auto overscroll-contain border-y border-rule">
        <ul className="recent m-0 list-none p-0" aria-busy={loading}>
          {loading
            ? SKELETON_ROWS.map((i) => (
                <li key={i} className="border-b border-rule last:border-b-0" aria-hidden="true">
                  <div className="flex w-full items-baseline gap-[14px] px-[8px] py-[11px]">
                    {/* Real text, made invisible rather than swapped for a bare
                        div: the glyphs still lay out and set the line's height,
                        so the bar behind them is exactly the row's real size. */}
                    <span
                      className="recent-title min-w-0 flex-1 animate-chip-breathe overflow-hidden text-ellipsis whitespace-nowrap rounded-[2px] bg-ink-wash-strong text-transparent"
                      style={{ animationDelay: `${i * -0.3}s` }}
                    >
                      Loading recent article title
                    </span>
                    <span
                      className="shrink-0 animate-chip-breathe rounded-[2px] bg-ink-wash-strong font-mono text-[11px] tracking-[0.04em] text-transparent"
                      style={{ animationDelay: `${i * -0.3}s` }}
                    >
                      3 hours ago
                    </span>
                    <span
                      className="recent-scope w-14.5 shrink-0 animate-chip-breathe rounded-[2px] border border-transparent bg-ink-wash-strong px-1.25 py-px text-center font-mono text-[10px] tracking-[0.09em] text-transparent"
                      style={{ animationDelay: `${i * -0.3}s` }}
                    >
                      full
                    </span>
                  </div>
                </li>
              ))
            : shown.map((item) => (
                <li key={item.qid} className="border-b border-rule last:border-b-0">
                  <button
                    type="button"
                    className="group flex w-full items-baseline gap-[14px] border-0 bg-none px-[8px] py-[11px] text-start [font:inherit] text-wiki-link hover:bg-paper-raised"
                    onClick={() => onOpen(item.title, item.lang)}
                    aria-label={`Compare ${item.title}, ${item.scope} cached ${relative(item.computedAt)}`}
                  >
                    <span
                      className="recent-title min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left group-hover:underline"
                      dir={LANG_META[item.lang].dir}
                      lang={item.lang}
                    >
                      {item.title}
                    </span>
                    {/* What's cached, not what a click will cost: a preview reads
                        free and a full run was already paid for, so the badge just
                        names which one is sitting in the cache right now. */}
                    <span className="shrink-0 font-mono text-[11px] tracking-[0.04em] text-ink-soft">
                      {relative(item.computedAt)}
                    </span>
                    <span
                      className={`recent-scope w-14.5 shrink-0 border border-rule px-1.25 py-px text-center font-mono text-[10px] tracking-[0.09em] uppercase text-ink-soft ${
                        item.scope === "full" ? "font-bold" : "opacity-80"
                      }`}
                      title={
                        item.scope === "preview"
                          ? "Cached run read the free preview"
                          : "Cached run read the whole article"
                      }
                    >
                      {item.scope}
                    </span>
                  </button>
                </li>
              ))}
        </ul>

        {!loading && !shown.length && (
          <p className="m-0 px-[8px] py-[16px] text-[14px] text-ink-soft">
            Nothing has been read in full yet.
          </p>
        )}
      </div>
    </Section>
  );
}
