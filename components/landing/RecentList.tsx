"use client";

import Section from "./Section";
import { LANG_META, type RecentArticle } from "@/lib/types";

interface Props {
  recent: RecentArticle[];
  onOpen: (title: string, lang: string) => void;
  /** "3 hours ago" — the formatter already used in the meta strip, passed in
   *  rather than duplicated. */
  relative: (iso: string) => string;
}

/**
 * Articles somebody has already paid to have read.
 *
 * Kept as a list rather than as cards on purpose: it is a ledger, and it is the
 * first half of the argument the footer below finishes — these cost money, and
 * they are free now because of it.
 */
export default function RecentList({ recent, onOpen, relative }: Props) {
  if (!recent.length) return null;

  return (
    <Section
      numeral="IV."
      heading="Recently compared:"
      className="py-[max(7vh,52px)]"
    >
      <p className="mt-4 mb-0 max-w-[52ch] text-[15px] leading-[1.65] text-ink-soft">

      </p>

      {/* `recent`, `recent-title` and `recent-langs` are not styling — they are
          the hooks `scripts/check-ui.mts` reads the list through, including the
          per-row `dir` assertion. Renaming them silently disables that check. */}
      <ul className="recent mt-[26px] mb-0 list-none border-t border-rule p-0">
        {recent.map((item) => (
          <li key={item.qid} className="border-b border-rule">
            <button
              type="button"
              className="group flex w-full items-baseline gap-[14px] border-0 bg-none px-[8px] py-[11px] text-start [font:inherit] text-wiki-link hover:bg-paper-raised"
              onClick={() => onOpen(item.title, item.lang)}
              aria-label={`Compare ${item.title}, cached ${relative(item.computedAt)}`}
            >
              <span
                className="recent-title min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left group-hover:underline"
                dir={LANG_META[item.lang].dir}
                lang={item.lang}
              >
                {item.title}
              </span>
              <span className="shrink-0 font-mono text-[11px] tracking-[0.04em] text-ink-soft max-tight:hidden">
                {relative(item.computedAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}
