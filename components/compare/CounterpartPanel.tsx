"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Box, CounterpartState } from "./useCounterpart";
import { useExplanation } from "./useExplanation";
import { track } from "@/lib/analytics";
import { LANG_META, type ArticleSnapshot, type Claim, type Lang, type TextRef } from "@/lib/types";

const KIND_LABEL: Record<Claim["type"], string> = {
  contradiction: "Contradiction",
  unique: "Only in one version",
  framing: "Different framing",
};

/** Summaries that only restate the kind, which the label above already says. */
const GENERIC = new Set(["Contradicting facts", "Different framing"]);

/** Around the matched sentence, so a long paragraph shows its relevant part. */
const WINDOW = 700;
/** Long enough on one sentence to count as having read it. */
const READ_DWELL = 1500;
const MARGIN = 10;
/** A selection running over many paragraphs shows the first few matches. */
const MAX_PARAGRAPHS = 4;

/** Paragraphs of one language to show, each with the sentences to pick out. */
interface Item {
  paragraph: TextRef;
  marks: TextRef[];
}

/** Where a long paragraph is cut so that what is picked out in it shows. */
function windowOf(paragraph: TextRef, marks: TextRef[]): { start: number; end: number } {
  const { start, end } = paragraph;
  if (end - start <= WINDOW) return { start, end };
  if (!marks.length) return { start, end: start + WINDOW };
  const lo = Math.min(...marks.map((m) => m.start));
  const hi = Math.max(...marks.map((m) => m.end));
  if (hi - lo > WINDOW) return { start: Math.max(start, lo - 80), end: Math.min(end, hi + 80) };
  const from = Math.max(start, Math.round((lo + hi) / 2 - WINDOW / 2));
  return { start: from, end: Math.min(end, from + WINDOW) };
}

/** `underline` picks out where the sentence under the pointer sits; `selection`
 *  picks out what corresponds to the reader's selection. */
type Tone = "underline" | "selection";

const MARK: Record<Tone, string> = {
  underline: "bg-wiki-page",
  selection: "bg-echo",
};

function Passage({ lang, article, item, tone }: { lang: Lang; article: ArticleSnapshot; item: Item; tone: Tone }) {
  const text = article.sections[item.paragraph.section]?.text ?? "";
  const { start, end } = windowOf(item.paragraph, item.marks);
  const marks = item.marks
    .filter((m) => m.start >= start && m.end <= end)
    .sort((a, b) => a.start - b.start);
  const pieces: React.ReactNode[] = [];
  let at = start;
  for (const m of marks) {
    if (m.start < at) continue;
    pieces.push(text.slice(at, m.start));
    pieces.push(
      <mark
        key={m.start}
        className={`${MARK[tone]} text-inherit rounded-[2px] box-decoration-clone shadow-[inset_0_-2px_0_var(--color-ink)]`}
      >
        {text.slice(m.start, m.end)}
      </mark>,
    );
    at = m.end;
  }
  pieces.push(text.slice(at, end));
  return (
    <p className="m-0 font-wiki text-[14.5px] leading-[1.62] text-wiki-text whitespace-pre-wrap" dir={LANG_META[lang].dir} lang={lang}>
      {start > item.paragraph.start ? "…" : ""}
      {pieces}
      {end < item.paragraph.end ? "…" : ""}
    </p>
  );
}

function Close({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      className="ms-auto -me-[6px] -my-[4px] w-[24px] h-[24px] leading-none text-[15px] text-ink-soft hover:text-ink cursor-pointer"
      onClick={onClose}
      aria-label="Close"
    >
      ×
    </button>
  );
}

/** One language's passage, laid over that language's column. */
function Overlay({
  lang,
  box,
  article,
  items,
  tone,
  note,
  missing,
  pinned,
  onClose,
}: {
  lang: Lang;
  box: Box;
  article: ArticleSnapshot;
  items: Item[];
  tone: Tone;
  /** What the passage is, after the language's name. */
  note: string;
  /** The hovered sentence is a gap in this language. */
  missing: boolean;
  pinned: boolean;
  onClose: () => void;
}) {
  const meta = LANG_META[lang];
  // A paragraph low on the screen would push its passages off the bottom, so a
  // passage that runs past it rises until it fits, or reaches the top.
  const ref = useRef<HTMLDivElement>(null);
  const [lift, setLift] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const top = box.top - window.scrollY;
    const over = top + el.scrollHeight + 2 - (window.innerHeight - MARGIN);
    setLift(over > 0 ? Math.max(0, Math.min(over, top - MARGIN)) : 0);
  }, [box]);
  return (
    <div
      ref={ref}
      className={`counterpart counterpart-passage absolute z-40 px-[10px] pt-[7px] pb-[9px] border rounded-[2px] shadow-offset overflow-y-auto animate-fade-in ${
        missing ? "bg-missing border-unique" : "bg-wiki-overlay border-wiki-border"
      } ${pinned ? "pointer-events-auto" : "pointer-events-none"}`}
      style={{ ...box, top: box.top - lift, maxHeight: box.maxHeight + lift }}
      data-lang={lang}
      data-missing={missing || undefined}
      dir={meta.dir}
      lang={lang}
    >
      <div className="flex items-baseline gap-2 mb-[4px] font-mono text-[10.5px] text-ink-soft" dir="ltr">
        {missing ? (
          <span className="text-unique font-semibold tracking-[0.04em] uppercase">Missing from {meta.label}</span>
        ) : (
          <span>{meta.label}</span>
        )}
        <span>{note}</span>
        {pinned && <Close onClose={onClose} />}
      </div>
      {items.length ? (
        <div className={`flex flex-col gap-[8px] ${missing ? "opacity-60" : ""}`}>
          {items.map((item) => (
            <Passage key={`${item.paragraph.section}:${item.paragraph.start}`} lang={lang} article={article} item={item} tone={tone} />
          ))}
        </div>
      ) : (
        <p className="m-0 text-[13.5px] text-ink-soft" dir="ltr">
          Nothing in the {meta.label} article covers this.
        </p>
      )}
    </div>
  );
}

function Explanation({ claim, cacheKey }: { claim: Claim; cacheKey?: string }) {
  const explanation = useExplanation(cacheKey, claim.id);
  return (
    <div className="px-[15px] pt-[12px] pb-[11px]">
      <span
        className="kind font-mono text-[10px] tracking-[0.09em] uppercase block mb-[5px] data-[type=contradiction]:text-contradiction data-[type=unique]:text-unique data-[type=framing]:text-framing"
        data-type={claim.type}
      >
        {KIND_LABEL[claim.type]}
      </span>
      {!GENERIC.has(claim.summary) && <span className="summary font-semibold block mb-[5px]">{claim.summary}</span>}
      <span className="explanation block text-[14px] leading-[1.55] text-ink-soft" aria-live="polite">
        {explanation.text ||
          (explanation.failed || !cacheKey ? claim.explanation : <span className="italic">Explaining…</span>)}
      </span>
      {claim.confidence !== undefined && (
        <div className="font-mono text-[11px] text-ink-soft mt-[7px]">
          {Math.round(claim.confidence * 100)}% confidence
          {claim.importance !== undefined && ` · importance ${claim.importance.toFixed(1)} of 3`}
        </div>
      )}
    </div>
  );
}

/**
 * Where the sentence under the pointer sits in the other languages: each one's
 * matched paragraph laid over its own column, level with the paragraph being
 * read, the corresponding sentence picked out. When the sentence carries a
 * difference, a card under the paragraph explains it. On a narrow screen there
 * is one column and no room beside it, so the card alone, as a sheet.
 */
export default function CounterpartPanel({
  state,
  articles,
  cacheKey,
  onClose,
}: {
  state: CounterpartState;
  articles: Record<string, ArticleSnapshot>;
  cacheKey?: string;
  onClose: () => void;
}) {
  const { lang, row, selection, claim, pinned, place } = state;
  const others = [...new Set((selection ?? [row]).flatMap((r) => Object.keys(r.to) as Lang[]))].filter(
    (l) => articles[l],
  );
  const elsewhere = place.mode === "inline" ? others.filter((l) => !place.overlays[l]) : [];
  const missing = (other: Lang) => claim?.type === "unique" && !!claim.missingFrom?.includes(other);

  /** The paragraphs to show in one language and what to pick out in them: for a
   *  selection, every paragraph its sentences were matched to, in reading order. */
  const itemsFor = (other: Lang): Item[] => {
    if (!selection) {
      const counterpart = row.to[other];
      if (!counterpart) return [];
      const marks = !missing(other) && counterpart.sentence ? [counterpart.sentence] : [];
      return [{ paragraph: counterpart.paragraph, marks }];
    }
    const byParagraph = new Map<string, Item>();
    for (const r of selection) {
      const counterpart = r.to[other];
      if (!counterpart) continue;
      const id = `${counterpart.paragraph.section}:${counterpart.paragraph.start}`;
      const item = byParagraph.get(id) ?? { paragraph: counterpart.paragraph, marks: [] };
      if (counterpart.sentence && !item.marks.some((m) => m.start === counterpart.sentence!.start)) {
        item.marks.push(counterpart.sentence);
      }
      byParagraph.set(id, item);
    }
    return [...byParagraph.values()]
      .sort((a, b) => a.paragraph.section - b.paragraph.section || a.paragraph.start - b.paragraph.start)
      .slice(0, MAX_PARAGRAPHS);
  };

  const noteFor = (other: Lang, items: Item[]): string => {
    if (missing(other)) return items.length ? "nearest passage" : "";
    if (!items.length) return "no matching passage";
    if (selection) {
      const sentences = items.reduce((n, item) => n + item.marks.length, 0);
      return sentences ? `${sentences} matching sentence${sentences === 1 ? "" : "s"}` : "matching passage";
    }
    const counterpart = row.to[other]!;
    return `${Math.round(counterpart.p * 100)}% match${counterpart.sentence ? "" : ", no single sentence"}`;
  };
  const tone: Tone = selection ? "selection" : "underline";

  useEffect(() => {
    const timer = setTimeout(
      () => void track("counterpart_viewed", { lang, claim: claim?.type ?? "none", pinned, mode: place.mode }),
      READ_DWELL,
    );
    return () => clearTimeout(timer);
  }, [state.key, lang, claim?.type, pinned, place.mode]);

  const card = place.card;
  return createPortal(
    <>
      {others.map(
        (other) =>
          place.overlays[other] && (
            <Overlay
              key={other}
              lang={other}
              box={place.overlays[other]}
              article={articles[other]}
              items={itemsFor(other)}
              tone={tone}
              note={noteFor(other, itemsFor(other))}
              missing={missing(other)}
              pinned={pinned}
              onClose={onClose}
            />
          ),
      )}
      {place.mode === "sheet" && claim && (
        <div
          className="counterpart counterpart-note fixed z-50 left-[8px] right-[8px] bottom-[8px] max-h-[55vh] overflow-y-auto bg-paper-raised border border-ink rounded-[2px] shadow-offset [direction:ltr] text-start pointer-events-auto"
          role="dialog"
          aria-label="Why this is marked"
        >
          <div className="flex justify-end px-[15px] pt-[8px] -mb-[14px]">
            <Close onClose={onClose} />
          </div>
          <Explanation claim={claim} cacheKey={cacheKey} />
        </div>
      )}
      {card && (claim || elsewhere.length > 0) && (
        <div
          className={`counterpart counterpart-note absolute z-50 bg-paper-raised border border-ink rounded-[2px] shadow-offset [direction:ltr] text-start overflow-y-auto animate-fade-in ${
            pinned ? "pointer-events-auto" : "pointer-events-none"
          }`}
          style={{
            left: card.left,
            width: card.width,
            top: card.top,
            maxHeight: card.maxHeight,
            transform: card.above ? "translateY(-100%)" : undefined,
          }}
          role={pinned ? "dialog" : "tooltip"}
          aria-label={claim ? "Why this is marked" : "The same passage in the other languages"}
        >
          {pinned && (
            <div className="flex justify-end px-[15px] pt-[8px] -mb-[14px]">
              <Close onClose={onClose} />
            </div>
          )}
          {claim && <Explanation claim={claim} cacheKey={cacheKey} />}
          {elsewhere.map((other) => {
            const items = itemsFor(other);
            const meta = LANG_META[other];
            return (
              <div key={other} className="px-[15px] py-[10px] border-t border-rule first:border-t-0">
                <div className="mb-[5px] font-mono text-[10.5px] text-ink-soft">
                  {meta.label} · {noteFor(other, items)}
                </div>
                {items.length ? (
                  <div className="flex flex-col gap-[8px]">
                    {items.map((item) => (
                      <Passage
                        key={`${item.paragraph.section}:${item.paragraph.start}`}
                        lang={other}
                        article={articles[other]}
                        item={item}
                        tone={tone}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="m-0 text-[13px] text-ink-soft">Nothing in the {meta.label} article covers this.</p>
                )}
              </div>
            );
          })}
          {!pinned && !selection && (
            <div className="px-[15px] py-[6px] font-mono text-[10px] text-ink-soft border-t border-rule">
              click the sentence to keep this open
            </div>
          )}
        </div>
      )}
    </>,
    document.body,
  );
}
