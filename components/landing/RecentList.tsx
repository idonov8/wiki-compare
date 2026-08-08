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
 * Kept as a list rather than as cards on purpose: it is a ledger, not a
 * gallery.
 */
export default function RecentList({ recent, onOpen, relative }: Props) {
  if (!recent.length) return null;

  return (
    <Section
      heading="Recently compared:"
      className="py-[max(7vh,52px)]"
    >
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
