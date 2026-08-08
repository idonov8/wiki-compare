"use client";

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

/** Rows to skeleton while the real list is in flight. Matches the cap the
 *  API queries for (`recentComparisons(12)`), so a full ledger settles into
 *  place rather than trimming down to it. */
const SKELETON_ROWS = Array.from({ length: 12 }, (_, i) => i);

/**
 * Articles somebody has already paid to have read.
 *
 * Kept as a list rather than as cards on purpose: it is a ledger, not a
 * gallery.
 */
export default function RecentList({ recent, onOpen, relative, loading }: Props) {
  if (!loading && !recent.length) return null;

  return (
    <Section
      heading="Recently compared:"
      className="py-[max(7vh,52px)]"
    >
      <ul className="recent mt-[26px] mb-0 list-none border-t border-rule p-0" aria-busy={loading}>
        {loading
          ? SKELETON_ROWS.map((i) => (
              <li key={i} className="border-b border-rule" aria-hidden="true">
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
                    className="shrink-0 animate-chip-breathe rounded-[2px] bg-ink-wash-strong font-mono text-[11px] tracking-[0.04em] text-transparent max-tight:hidden"
                    style={{ animationDelay: `${i * -0.3}s` }}
                  >
                    3 hours ago
                  </span>
                  <span
                    className="recent-scope w-14.5 shrink-0 animate-chip-breathe rounded-[2px] border border-transparent bg-ink-wash-strong px-1.25 py-px text-center font-mono text-[10px] tracking-[0.09em] text-transparent max-tight:hidden"
                    style={{ animationDelay: `${i * -0.3}s` }}
                  >
                    full
                  </span>
                </div>
              </li>
            ))
          : recent.map((item) => (
              <li key={item.qid} className="border-b border-rule">
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
                  <span className="shrink-0 font-mono text-[11px] tracking-[0.04em] text-ink-soft max-tight:hidden">
                    {relative(item.computedAt)}
                  </span>
                  <span
                    className={`recent-scope w-14.5 shrink-0 border border-rule px-1.25 py-px text-center font-mono text-[10px] tracking-[0.09em] uppercase text-ink-soft max-tight:hidden ${
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
    </Section>
  );
}
