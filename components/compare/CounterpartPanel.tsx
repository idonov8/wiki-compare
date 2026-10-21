"use client";

import { useEffect } from "react";
import type { CounterpartState } from "./useCounterpart";
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
/** Long enough on one sentence to count as having read the panel. */
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
    <p className="m-0 font-wiki text-[13.5px] leading-[1.55] text-wiki-text whitespace-pre-wrap" dir={LANG_META[lang].dir} lang={lang}>
      {lead}
      {inside ? (
        <>
          {text.slice(start, s.start)}
          <mark className="bg-wiki-shade text-inherit rounded-[2px] box-decoration-clone shadow-[inset_0_-2px_0_var(--color-ink)]">
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

/**
 * Where the sentence under the pointer sits in each other language: the
 * paragraph it was matched to, with the corresponding sentence picked out, or a
 * plain statement that nothing there covers it. When the sentence carries a
 * difference, the panel leads with it and with an explanation written for it.
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
  const explanation = useExplanation(cacheKey, claim?.id);
  const others = (Object.keys(row.to) as Lang[]).filter((l) => articles[l]);

  useEffect(() => {
    const timer = setTimeout(
      () => void track("counterpart_viewed", { lang, claim: claim?.type ?? "none", pinned }),
      READ_DWELL,
    );
    return () => clearTimeout(timer);
  }, [state.key, lang, claim?.type, pinned]);

  const sheet = place.mode === "sheet";
  return (
    <div
      className={`counterpart fixed z-50 bg-paper-raised border border-ink rounded-[2px] shadow-offset [direction:ltr] text-start overflow-y-auto ${
        pinned ? "pointer-events-auto" : "pointer-events-none"
      } ${sheet ? "left-[8px] right-[8px] bottom-[8px] max-h-[55vh]" : ""}`}
      style={sheet ? undefined : { left: place.left, width: place.width, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight }}
      role={pinned ? "dialog" : "tooltip"}
      aria-label="The same passage in the other languages"
    >
      {pinned && (
        <div className="sticky top-0 z-10 flex items-center px-[15px] h-[30px] bg-paper-raised border-b border-rule font-mono text-[10.5px] text-ink-soft">
          <span>in the other languages</span>
          <button
            type="button"
            className="ms-auto -me-[6px] w-[26px] h-[26px] leading-none text-[15px] hover:text-ink cursor-pointer"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}
      {claim && (
        <div className="px-[15px] pt-[13px] pb-[11px] border-b border-rule">
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
      )}
      {others.map((other) => {
        const counterpart = row.to[other];
        const meta = LANG_META[other];
        return (
          <div key={other} className="px-[15px] py-[11px] border-b border-rule last:border-b-0">
            <div className="flex items-baseline gap-2 mb-[6px] font-mono text-[11px] text-ink-soft">
              <span className="font-body text-[14px] text-ink">{meta.native}</span>
              {counterpart ? (
                <span>matching passage{counterpart.sentence ? "" : " (no single sentence)"}</span>
              ) : (
                <span>no matching passage</span>
              )}
              {counterpart && <span className="ms-auto">{Math.round(counterpart.p * 100)}% match</span>}
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
        <div className="px-[15px] py-[7px] font-mono text-[10.5px] text-ink-soft border-t border-rule">
          click the sentence to keep this open
        </div>
      )}
    </div>
  );
}
