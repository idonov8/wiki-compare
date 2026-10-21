"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Box, CounterpartState } from "./useCounterpart";
import { useExplanation } from "./useExplanation";
import { track } from "@/lib/analytics";
import { LANG_META, type ArticleSnapshot, type Claim, type Counterpart, type Lang } from "@/lib/types";

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

function Passage({ lang, article, counterpart }: { lang: Lang; article: ArticleSnapshot; counterpart: Counterpart }) {
  const text = article.sections[counterpart.paragraph.section]?.text ?? "";
  let { start, end } = counterpart.paragraph;
  const s = counterpart.sentence;
  if (end - start > WINDOW) {
    const middle = s ? (s.start + s.end) / 2 : start + WINDOW / 2;
    start = Math.max(start, Math.round(middle - WINDOW / 2));
    end = Math.min(end, start + WINDOW);
  }
  const lead = start > counterpart.paragraph.start ? "…" : "";
  const tail = end < counterpart.paragraph.end ? "…" : "";
  const inside = s && s.start >= start && s.end <= end;
  return (
    <p className="m-0 font-wiki text-[14.5px] leading-[1.62] text-wiki-text whitespace-pre-wrap" dir={LANG_META[lang].dir} lang={lang}>
      {lead}
      {inside ? (
        <>
          {text.slice(start, s.start)}
          <mark className="bg-wiki-page text-inherit rounded-[2px] box-decoration-clone shadow-[inset_0_-2px_0_var(--color-ink)]">
            {text.slice(s.start, s.end)}
          </mark>
          {text.slice(s.end, end)}
        </>
      ) : (
        text.slice(start, end)
      )}
      {tail}
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
  counterpart,
  pinned,
  onClose,
}: {
  lang: Lang;
  box: Box;
  article: ArticleSnapshot;
  counterpart: Counterpart | null | undefined;
  pinned: boolean;
  onClose: () => void;
}) {
  const meta = LANG_META[lang];
  return (
    <div
      className={`counterpart counterpart-passage absolute z-40 px-[10px] pt-[7px] pb-[9px] bg-wiki-overlay border border-wiki-border rounded-[2px] shadow-offset max-h-[70vh] overflow-y-auto animate-fade-in ${
        pinned ? "pointer-events-auto" : "pointer-events-none"
      }`}
      style={box}
      data-lang={lang}
      dir={meta.dir}
      lang={lang}
    >
      <div className="flex items-baseline gap-2 mb-[4px] font-mono text-[10.5px] text-ink-soft" dir="ltr">
        <span>{meta.label}</span>
        <span>
          {counterpart
            ? `${Math.round(counterpart.p * 100)}% match${counterpart.sentence ? "" : ", no single sentence"}`
            : "no matching passage"}
        </span>
        {pinned && <Close onClose={onClose} />}
      </div>
      {counterpart ? (
        <Passage lang={lang} article={article} counterpart={counterpart} />
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
  const { lang, row, claim, pinned, place } = state;
  const others = (Object.keys(row.to) as Lang[]).filter((l) => articles[l]);
  const elsewhere = place.mode === "inline" ? others.filter((l) => !place.overlays[l]) : [];

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
              counterpart={row.to[other]}
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
          className={`counterpart counterpart-note absolute z-50 bg-paper-raised border border-ink rounded-[2px] shadow-offset [direction:ltr] text-start max-h-[60vh] overflow-y-auto animate-fade-in ${
            pinned ? "pointer-events-auto" : "pointer-events-none"
          }`}
          style={{ left: card.left, width: card.width, top: card.top, transform: card.above ? "translateY(-100%)" : undefined }}
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
            const counterpart = row.to[other];
            const meta = LANG_META[other];
            return (
              <div key={other} className="px-[15px] py-[10px] border-t border-rule first:border-t-0">
                <div className="mb-[5px] font-mono text-[10.5px] text-ink-soft">
                  {meta.label} · {counterpart ? `${Math.round(counterpart.p * 100)}% match` : "no matching passage"}
                </div>
                {counterpart ? (
                  <Passage lang={other} article={articles[other]} counterpart={counterpart} />
                ) : (
                  <p className="m-0 text-[13px] text-ink-soft">Nothing in the {meta.label} article covers this.</p>
                )}
              </div>
            );
          })}
          {!pinned && (
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
