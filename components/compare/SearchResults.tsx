"use client";

import type { Hit } from "./types";
import { LANG_META, type Lang } from "@/lib/types";

export default function SearchResults({
  hits,
  busy,
  onPick,
}: {
  hits: Hit[];
  busy: boolean;
  onPick: (title: string, lang: string) => void;
}) {
  return (
    <div className="results px-[24px] pt-[40px] pb-[56px] max-w-[64ch]">
      <h2 className="font-display text-[27px] font-normal m-0 mb-[6px]">
        Which article did you mean?
      </h2>
      <p className="results-note text-ink-soft text-[14px] m-0 mb-[18px]">
        Results from {LANG_META[hits[0]?.lang as Lang]?.label ?? hits[0]?.lang} Wikipedia. The other
        languages are found through the article&apos;s Wikidata item.
      </p>
      <ul className="list-none m-0 p-0">
        {hits.map((hit) => (
          <li
            key={`${hit.lang}:${hit.title}`}
            className="flex items-baseline gap-[12px] border-t border-rule last:border-b last:border-rule"
          >
            <button
              className="hit flex-1 text-start px-[4px] py-[12px] bg-transparent border-none hover:bg-paper-raised disabled:opacity-50 disabled:cursor-progress"
              onClick={() => onPick(hit.title, hit.lang)}
              disabled={busy}
            >
              <span className="hit-title block text-[16px]">{hit.title}</span>
              {hit.description && (
                <span className="hit-desc block text-[13px] text-ink-soft">{hit.description}</span>
              )}
            </button>
            <a
              className="hit-link font-mono text-[11px] text-wiki-link no-underline whitespace-nowrap hover:underline"
              href={hit.url}
              target="_blank"
              rel="noreferrer"
            >
              open on Wikipedia ↗
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
