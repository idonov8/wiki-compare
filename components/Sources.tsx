"use client";

import { useEffect, useState } from "react";
import LangSlide, { type LangSlideState } from "./compare/LangSlide";
import { useSources } from "./compare/useSources";
import { track } from "@/lib/analytics";
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

/**
 * One source in one version's list.
 *
 * Every entry is set the same way. Which versions share it is said by the badge
 * and by nothing else — a faded or struck-through entry reads as a source that
 * counts for less, and a source three versions agree on is not worth less than
 * one only a single version found. The only thing that changes an entry's
 * appearance is a blindspot being highlighted, which is a question the reader
 * asked.
 */
function Entry({
  source,
  lang,
  /** The language whose blindspots are being highlighted, if any. */
  blindspot,
}: {
  source: SourceCitation;
  lang: Lang;
  blindspot: Lang | null;
}) {
  const others = source.citedIn.filter((l) => l !== lang);
  // No badge means nobody else read it, which is the one thing in this list a
  // reader is scanning for. A shade of weight is enough to make it findable
  // without turning the shared entries into an afterthought.
  const only = others.length === 0;
  const missing = !!blindspot && lang !== blindspot && !source.citedIn.includes(blindspot);
  const dimmed = !!blindspot && !missing;

  return (
    <li
      data-cited={source.citedIn.join(" ")}
      data-missing={missing ? "" : undefined}
      className={`source-entry py-[5px] border-t border-rule first:border-t-0 transition-[opacity,background-color] duration-150 ${
        missing ? "bg-mark-unique inset-shadow-unique px-[6px] -mx-[6px]" : ""
      } ${dimmed ? "opacity-25" : ""}`}
      // The badge says which versions in two letters; this says it in a
      // sentence, for anyone who does not already know what "he · ar" means.
      title={others.length ? `This source is cited in ${versions(source.citedIn)}.` : undefined}
    >
      <div className="flex items-baseline gap-[7px]">
        {source.url ? (
          <a
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className={`source-title min-w-0 text-[12px] leading-[1.45] text-wiki-link no-underline hover:underline ${only ? "font-semibold" : ""}`}
          >
            {source.title || source.text}
          </a>
        ) : (
          <span className={`source-title min-w-0 text-[12px] leading-[1.45] ${only ? "font-semibold" : ""}`}>
            {source.title || source.text}
          </span>
        )}
        {others.length > 0 && (
          <span
            dir="ltr"
            className="source-badge shrink-0 border border-rule px-[4px] py-px font-mono text-[9px] uppercase tracking-[0.08em] text-ink-soft"
            aria-label={`also cited in ${versions(others)}`}
          >
            {others.join(" · ")}
          </span>
        )}
      </div>
      {source.domain && (
        // `bdi` rather than `dir` on the line: the host reads left-to-right
        // wherever it is printed, but the line it sits on belongs to the column.
        <div className="mt-px font-mono text-[9.5px] text-ink-soft">
          <bdi>{source.domain}</bdi>
        </div>
      )}
    </li>
  );
}

function Column({
  payload,
  lang,
  /** Whether this is the only list on screen, which is what a phone shows. The
   *  blindspots it can then mark are all in lists the reader has to switch to. */
  alone,
  blindspot,
  onBlindspot,
}: {
  payload: SourcesPayload;
  lang: Lang;
  alone: boolean;
  blindspot: Lang | null;
  onBlindspot: (lang: Lang | null) => void;
}) {
  const meta = LANG_META[lang];
  const list = payload.sources[lang] ?? [];
  const comparing = payload.langs.length > 1;
  const unique = list.filter((s) => s.citedIn.length === 1).length;
  const blind = blindspotsOf(payload, lang).size;
  const active = blindspot === lang;
  // The notes below are the interface talking, in English, inside a column that
  // may read right-to-left — where a sentence opening with a numeral had the
  // numeral reordered to the far end and the full stop shunted to the wrong
  // side. So they are set left-to-right and only *aligned* to the column's own
  // start edge, which is where the list under them begins.
  const note = `font-mono text-[10px] leading-[1.6] tracking-[0.04em] ${
    meta.dir === "rtl" ? "text-right" : "text-left"
  }`;

  return (
    // Physical borders and padding, not logical: the columns sit en|he|ar
    // left-to-right whatever direction each of them reads in, so the rule
    // belongs between every pair rather than on each column's own start edge —
    // which in Hebrew and Arabic is the right, and drew both of their rules in
    // the same place.
    <section
      data-sources={lang}
      dir={meta.dir}
      lang={lang}
      className="sources-column min-w-0 px-[20px] first:pl-0 last:pr-0 border-rule border-l first:border-l-0 max-cols:border-l-0 max-cols:px-0"
    >
      <div className="flex flex-wrap items-baseline gap-x-[9px] gap-y-[5px] pb-[6px] mb-[8px] border-b-2 border-ink">
        <span className="font-body text-[15px] leading-none text-ink">{meta.native}</span>
        <span dir="ltr" className="font-mono text-[10px] tracking-[0.04em] text-ink-soft">
          {list.length} sources{comparing ? ` · ${unique} unique` : ""}
        </span>
        {comparing && (
          <button
            type="button"
            disabled={blind === 0}
            aria-pressed={active}
            onClick={() => onBlindspot(active ? null : lang)}
            className={`blindspot-toggle ms-auto shrink-0 grid border px-[8px] py-[3px] font-mono text-[10px] tracking-[0.04em] transition-colors duration-[120ms] disabled:opacity-40 ${
              active
                ? "border-ink bg-ink text-paper"
                : "border-rule text-ink-soft hover:border-ink hover:text-ink"
            }`}
          >
            {/* Both labels in one cell, so pressing the control cannot change
                its width and shift the header under the reader's finger. */}
            <span className="col-start-1 row-start-1 invisible" aria-hidden="true">
              Highlight blindspots
            </span>
            <span className="col-start-1 row-start-1">
              {active ? "Clear" : "Highlight blindspots"}
            </span>
          </button>
        )}
      </div>

      {active && (
        <p dir="ltr" role="status" className={`m-0 mb-[8px] text-ink ${note}`}>
          {blind} {blind === 1 ? "source" : "sources"} the other versions cite and this one does
          not,{" "}
          {alone ? "marked in their lists — switch language to see them." : "marked in their lists."}
        </p>
      )}

      {list.length ? (
        <ol className="m-0 p-0 list-none">
          {list.map((source) => (
            <Entry key={source.group} source={source} lang={lang} blindspot={blindspot} />
          ))}
        </ol>
      ) : (
        <p dir="ltr" className={`m-0 text-ink-soft ${note}`}>
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
 * disagreed from. Every entry is set alike and the badge does the talking: an
 * entry with no badge is a source only this version read, which is the reading
 * the whole panel exists for.
 *
 * None of it involves a model. Footnotes are matched on web address, DOI, ISBN
 * and title, all of which are the same string in Hebrew, Arabic and English, so
 * the panel costs nothing, needs no credit, and is shown on a preview — where
 * the marks above it stop a few sections in but the reference list does not.
 */
export default function Sources({
  articles,
  /** The editions on screen, exactly as the article columns have them: three
   *  side by side, fewer if the reader hid one, and one at a time on a phone,
   *  where the floating switch moves between them. The matching underneath is
   *  always over every edition the subject has, so a badge naming a version the
   *  reader is not currently looking at still means what it says. */
  visible,
  /** The same surface the article is swiped over, so a flick down here moves
   *  the language exactly as it does up there. */
  slide,
  /** The subject, for the analytics event. */
  qid,
}: {
  articles: Record<string, ArticleSnapshot>;
  visible: Lang[];
  slide: LangSlideState;
  qid?: string;
}) {
  const { anchor, sources, failed, loading } = useSources(articles);
  const [blindspot, setBlindspot] = useState<Lang | null>(null);

  // The highlight belongs to the lists it was drawn over.
  useEffect(() => setBlindspot(null), [sources]);

  // Scrolling this far down is the interaction: the panel is an appendix, and
  // how many readers reach it at all is the first thing worth knowing about it.
  useEffect(() => {
    if (!sources) return;
    void track("sources_viewed", {
      qid,
      langs: sources.langs.length,
      sources: sources.langs.reduce((n, l) => n + (sources.sources[l]?.length ?? 0), 0),
      shared: sources.langs.reduce(
        (n, l) => n + (sources.sources[l] ?? []).filter((s) => s.citedIn.length > 1).length,
        0,
      ),
    });
  }, [sources, qid]);

  const shown = sources ? sources.langs.filter((lang) => visible.includes(lang)) : [];

  const highlight = (lang: Lang | null) => {
    setBlindspot(lang);
    if (lang && sources) {
      void track("sources_blindspots_highlighted", {
        qid,
        lang,
        blindspots: blindspotsOf(sources, lang).size,
      });
    }
  };

  return (
    <section
      ref={anchor}
      id="sources"
      className="sources mt-[max(6vh,40px)] border-t border-rule px-[24px] pt-[22px] pb-[10px] max-tight:px-[17px]"
    >
      <h2 className="m-0 font-display text-[26px] leading-none text-ink">Sources</h2>

      {loading && (
        <p className="mt-[14px] font-mono text-[10px] tracking-[0.04em] text-ink-soft">
          Reading the reference lists…
        </p>
      )}
      {failed && (
        <p className="mt-[14px] font-mono text-[10px] tracking-[0.04em] text-ink-soft">
          The reference lists could not be read. The comparison above is unaffected.
        </p>
      )}

      {sources && shown.length > 0 && (
        <LangSlide {...slide}>
          <div
            className="mt-[16px] grid items-start max-cols:block"
            style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}
          >
            {shown.map((lang) => (
              <Column
                key={lang}
                payload={sources}
                lang={lang}
                alone={shown.length === 1}
                blindspot={blindspot}
                onBlindspot={highlight}
              />
            ))}
          </div>
        </LangSlide>
      )}
    </section>
  );
}
