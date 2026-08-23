"use client";

import { useEffect, useState } from "react";
import { useSources } from "./compare/useSources";
import {
  LANG_META,
  type ArticleSnapshot,
  type Lang,
  type SourceCitation,
  type SourcesPayload,
} from "@/lib/types";

/** "the Hebrew, Arabic and English versions", for the tooltip that has to say
 *  in words what a two-letter badge says in shorthand. */
function versions(langs: Lang[]): string {
  const names = langs.map((lang) => LANG_META[lang].label);
  if (names.length === 1) return `the ${names[0]} version`;
  return `the ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} versions`;
}

/** How many sources the other versions cite that this one does not. Counted by
 *  matched group, so one source two versions share is one blindspot rather
 *  than two. */
function blindspotsOf(payload: SourcesPayload, target: Lang): Set<string> {
  const groups = new Set<string>();
  for (const lang of payload.langs) {
    if (lang === target) continue;
    for (const source of payload.sources[lang] ?? []) {
      if (!source.citedIn.includes(target)) groups.add(source.group);
    }
  }
  return groups;
}

function Entry({
  source,
  lang,
  /** How many versions are being compared. One of them is not a comparison:
   *  every entry would be "cited in all one" and wear a strikethrough for it. */
  total,
  /** The language whose blindspots are being highlighted, if any. */
  blindspot,
}: {
  source: SourceCitation;
  lang: Lang;
  total: number;
  blindspot: Lang | null;
}) {
  const shared = total > 1 && source.citedIn.length > 1;
  const everywhere = total > 1 && source.citedIn.length === total;
  const others = source.citedIn.filter((l) => l !== lang);
  const missing = !!blindspot && lang !== blindspot && !source.citedIn.includes(blindspot);
  const dimmed = !!blindspot && !missing;

  // The strikethrough sits on the text rather than on the link, because a link
  // has to keep `text-decoration: none` to not be underlined, and that would be
  // the same property saying two things.
  const label = (
    <span className={`source-title ${everywhere ? "line-through decoration-[1px]" : ""}`}>
      {source.title || source.text}
    </span>
  );

  return (
    <li
      data-cited={source.citedIn.join(" ")}
      data-missing={missing ? "" : undefined}
      className={`source-entry py-[7px] border-t border-rule first:border-t-0 transition-[opacity,background-color] duration-150 ${
        missing ? "bg-mark-unique inset-shadow-unique px-[6px] -mx-[6px]" : ""
      } ${dimmed ? "opacity-25" : shared && !missing ? "opacity-55" : ""}`}
      // The badge says which versions in two letters; this says it in a
      // sentence, for anyone who does not already know what "he · ar" means.
      title={shared ? `This source is cited in ${versions(source.citedIn)}.` : undefined}
    >
      <div className="flex items-baseline gap-[8px]">
        {source.url ? (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className="min-w-0 text-[13.5px] leading-[1.5] text-wiki-link no-underline hover:underline"
          >
            {label}
          </a>
        ) : (
          <span className="min-w-0 text-[13.5px] leading-[1.5]">{label}</span>
        )}
        {shared && (
          <span
            dir="ltr"
            className="source-badge shrink-0 border border-rule px-[5px] py-[1px] font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft"
            aria-label={`also cited in ${versions(others)}`}
          >
            {others.join(" · ")}
          </span>
        )}
      </div>
      {source.domain && (
        // `bdi` rather than `dir` on the line: the host reads left-to-right
        // wherever it is printed, but the line it sits on belongs to the column.
        <div className="mt-[2px] font-mono text-[10.5px] text-ink-soft">
          <bdi>{source.domain}</bdi>
        </div>
      )}
    </li>
  );
}

function Column({
  payload,
  lang,
  blindspot,
  onBlindspot,
}: {
  payload: SourcesPayload;
  lang: Lang;
  blindspot: Lang | null;
  onBlindspot: (lang: Lang | null) => void;
}) {
  const meta = LANG_META[lang];
  const list = payload.sources[lang] ?? [];
  const comparing = payload.langs.length > 1;
  const onlyHere = list.filter((s) => s.citedIn.length === 1).length;
  const blind = blindspotsOf(payload, lang).size;
  const active = blindspot === lang;

  return (
    <section
      data-sources={lang}
      dir={meta.dir}
      lang={lang}
      className="sources-column min-w-0 px-[22px] first:ps-0 last:pe-0 border-rule border-s first:border-s-0 max-cols:border-s-0 max-cols:border-t max-cols:first:border-t-0 max-cols:px-0 max-cols:pt-[18px] max-cols:mt-[18px]"
    >
      <div className="flex flex-wrap items-baseline gap-x-[10px] gap-y-[6px] pb-[8px] mb-[10px] border-b-2 border-ink">
        <span className="font-body text-[17px] leading-none text-ink">{meta.native}</span>
        <span dir="ltr" className="font-mono text-[11px] tracking-[0.04em] text-ink-soft">
          {list.length} sources{comparing ? ` · ${onlyHere} only here` : ""}
        </span>
        {comparing && (
          <button
            type="button"
            disabled={blind === 0}
            aria-pressed={active}
            onClick={() => onBlindspot(active ? null : lang)}
            className={`blindspot-toggle ms-auto shrink-0 border px-[9px] py-[3px] font-mono text-[11px] tracking-[0.04em] transition-colors duration-[120ms] disabled:opacity-40 ${
              active
                ? "border-ink bg-ink text-paper"
                : "border-rule text-ink-soft hover:border-ink hover:text-ink"
            }`}
          >
            {active ? "Clear" : "Highlight blindspots"}
          </button>
        )}
      </div>

      {active && (
        <p
          role="status"
          className="m-0 mb-[10px] font-mono text-[11px] leading-[1.6] tracking-[0.04em] text-ink"
        >
          {blind} {blind === 1 ? "source" : "sources"} the other versions cite and this one does
          not, marked in their lists.
        </p>
      )}

      {list.length ? (
        <ol className="m-0 p-0 list-none">
          {list.map((source) => (
            <Entry
              key={source.group}
              source={source}
              lang={lang}
              total={payload.langs.length}
              blindspot={blindspot}
            />
          ))}
        </ol>
      ) : (
        <p className="m-0 font-mono text-[11px] leading-[1.6] tracking-[0.04em] text-ink-soft">
          Nothing in this version's footnotes can be pinned to a link, a DOI, an ISBN or a stated
          title, so there is nothing here to match against.
        </p>
      )}
    </section>
  );
}

/**
 * What each version was written from, side by side.
 *
 * The comparison above says where the versions disagree; this says what they
 * disagreed from. A source in full ink is one only this version read, which is
 * the reading the whole panel exists for — everything faded is common ground,
 * and everything struck through was read by all of them.
 *
 * None of it involves a model. Footnotes are matched on web address, DOI, ISBN
 * and title, all of which are the same string in Hebrew, Arabic and English, so
 * the panel costs nothing, needs no credit, and is shown on a preview — where
 * the marks above it stop a few sections in but the reference list does not.
 */
export default function Sources({ articles }: { articles: Record<string, ArticleSnapshot> }) {
  const { anchor, sources, failed, loading } = useSources(articles);
  const [blindspot, setBlindspot] = useState<Lang | null>(null);

  // The highlight belongs to the lists it was drawn over.
  useEffect(() => setBlindspot(null), [sources]);

  return (
    <section
      ref={anchor}
      id="sources"
      className="sources mt-[max(6vh,40px)] border-t border-rule px-[24px] pt-[26px] pb-[10px] max-tight:px-[17px]"
    >
      <h2 className="m-0 font-display text-[30px] leading-none text-ink">Sources</h2>
      <p className="m-0 mt-[9px] max-w-[74ch] font-mono text-[11px] leading-[1.75] tracking-[0.04em] text-ink-soft">
        Every footnote that can be pinned to something — a web address, a DOI, an ISBN, a stated
        title — matched across the versions on those alone. Arithmetic rather than a reading, which
        is why it stands on a preview too. Faded entries are cited by another version as well,
        struck-through ones by all of them. What is left in full ink is what only that version read.
      </p>

      {loading && (
        <p className="mt-[18px] font-mono text-[11px] tracking-[0.04em] text-ink-soft">
          Reading the reference lists…
        </p>
      )}
      {failed && (
        <p className="mt-[18px] font-mono text-[11px] tracking-[0.04em] text-ink-soft">
          The reference lists could not be read. The comparison above is unaffected.
        </p>
      )}

      {sources && (
        <div
          className="mt-[22px] grid items-start max-cols:block"
          style={{ gridTemplateColumns: `repeat(${sources.langs.length}, minmax(0, 1fr))` }}
        >
          {sources.langs.map((lang) => (
            <Column
              key={lang}
              payload={sources}
              lang={lang}
              blindspot={blindspot}
              onBlindspot={setBlindspot}
            />
          ))}
        </div>
      )}
    </section>
  );
}
