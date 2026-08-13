"use client";

import { useEffect, useState } from "react";
import { LANG_META, type ArticleSnapshot, type Lang } from "@/lib/types";

/**
 * How much text each edition has, and which of them are on screen.
 *
 * The strip used to carry three `EN`/`HE`/`AR` boxes that said only whether a
 * column was showing. They were the right control and the wrong reading: the
 * single most useful fact about a set of Wikipedia articles is how unevenly
 * they are written — an English article is routinely five or ten times its
 * Hebrew counterpart — and that fact was nowhere on the page. It is the thing
 * this site exists to point at, and the control that names the three editions
 * is where it costs nothing to show.
 *
 * So each box grew a bar. The chart and the control are the same object rather
 * than a chart placed next to one: a filled bar means that edition is on
 * screen, a hollow bar of the same height means it exists and is not, and
 * pressing either changes which. Nothing here is decoration that a reader
 * could mistake for state.
 */

/** That the chart's own note has been read on this device. Same pattern as the
 *  legend's flag, and for the same reason — a panel dismissed once should stay
 *  dismissed — but its own key, since a reader can have seen one note and not
 *  the other. */
const BARS_SEEN = "wiki-compare:langbars-seen";

/** The bar zone, and the tallest a bar in it may get. The difference between
 *  them is headroom for the figure printed above the bar, so even the longest
 *  edition has room to say its own number. */
const ZONE = 40;
const TALLEST = 26;
/** An article that exists never draws nothing. At a fortieth of the longest
 *  version a bar rounds away to no pixels, and a language sitting over an empty
 *  slot reads as a broken control rather than as a short article. */
const SHORTEST = 2;

/** Words rather than characters. Both are honest, and neither is comparable
 *  across scripts without an argument — but Hebrew and Arabic drop the vowels
 *  English writes out, so counting characters understates them by a third
 *  before any real difference in coverage is measured. Words survive that. */
export function articleWords(article: ArticleSnapshot): number {
  return article.sections.reduce((total, section) => {
    const text = section.text.trim();
    return total + (text ? text.split(/\s+/).length : 0);
  }, 0);
}

/** Three characters at the widest, because the figure has a 40px column to sit
 *  over and the bar underneath it is what carries the comparison anyway. */
function compact(words: number): string {
  if (words < 1000) return String(words);
  const thousands = words / 1000;
  return `${thousands < 10 ? thousands.toFixed(1).replace(/\.0$/, "") : Math.round(thousands)}k`;
}

export default function LangBars({
  langs,
  articles,
  onScreen,
  onPick,
  onIntroClose,
}: {
  langs: Lang[];
  articles: Record<string, ArticleSnapshot>;
  /** The editions rendered right now: every shown column on a wide screen, the
   *  one being read on a narrow one. Both are the same sentence — "this is on
   *  screen" — which is why one chart can serve both. */
  onScreen: Lang[];
  onPick: (lang: Lang) => void;
  /** Fired once, the moment the chart's own intro note is dismissed — either by
   *  the reader or, having nothing to show, on mount. The legend's note holds
   *  itself back until this fires, so the two never fight for the same reader's
   *  attention at once. */
  onIntroClose?: () => void;
}) {
  /** Whether the note explaining the chart is open. Starts closed for the same
   *  reason the legend's does: it must not flash in during hydration only to
   *  vanish once the seen-flag is read. */
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let seen = true;
    try {
      seen = localStorage.getItem(BARS_SEEN) === "1";
    } catch {
      seen = false;
    }
    if (!seen) setOpen(true);
    else onIntroClose?.();
    // Runs once, on mount, same as the legend's own version of this effect —
    // `onIntroClose` is left out of the dependency list on purpose so a
    // parent re-render never re-fires the seen-flag check.
  }, []);

  function close(): void {
    setOpen(false);
    try {
      localStorage.setItem(BARS_SEEN, "1");
    } catch {}
    onIntroClose?.();
  }

  const words = Object.fromEntries(
    langs.map((lang) => [lang, articles[lang] ? articleWords(articles[lang]) : 0]),
  ) as Record<Lang, number>;

  // Longest first, which is the whole reason to draw it as a chart: sorted, the
  // drop from one edition to the next is a shape you read in one glance instead
  // of three numbers you compare. The columns below stay in their own fixed
  // order — this sorts the chart, not the page.
  const sorted = [...langs].sort((a, b) => words[b] - words[a]);
  const longest = Math.max(...sorted.map((lang) => words[lang]), 1);

  return (
    // The wrapper is what the note is anchored to and what carries the strip's
    // sizing; `.toggles` inside stays the chart itself, the same split `Legend`
    // makes between `.legend-key` and `.legend`.
    //
    // Given a share of the width on a phone rather than sitting at its natural
    // size against the left margin, which left the strip crowded into two
    // thirds of the screen with the rest blank. The slots widen and the bars
    // spread; the buttons stay flush against each other, because the axis under
    // them is only continuous while they are.
    <div className="langbars-key relative max-tight:flex-1 max-tight:basis-0">
      <div className="toggles flex" role="group" aria-label="Editions and how long each one is">
        {sorted.map((lang, index) => {
          const on = onScreen.includes(lang);
          const height = Math.max(SHORTEST, Math.round((words[lang] / longest) * TALLEST));
          return (
            <button
              key={lang}
              // No gap between the buttons, so the baselines below the bars meet
              // into one unbroken axis across all three.
              className="toggle group flex w-[44px] flex-col items-center bg-transparent max-tight:flex-1"
              aria-pressed={on}
              aria-label={`${LANG_META[lang].label}, ${words[lang].toLocaleString()} words`}
              onClick={() => onPick(lang)}
            >
              <span
                className="relative flex w-full items-end justify-center"
                style={{ height: ZONE }}
              >
                {/* Printed for every edition, not only the ones showing, for the
                    same reason the hollow bar is drawn at all. Hidden from
                    assistive technology, which is given the exact count in the
                    button's label rather than this rounded one. */}
                <span
                  className={`absolute inset-x-0 text-center font-mono text-[10px] leading-none ${
                    on ? "text-ink" : "text-ink-soft"
                  }`}
                  style={{ bottom: height + 3 }}
                  aria-hidden
                >
                  {compact(words[lang])}
                </span>
                <span
                  // Hollow rather than absent when the edition is off screen: a
                  // bar drawn to the same height either way is what makes the
                  // hidden version's size still readable, which is the only
                  // reason a reader would press it back on.
                  className={`langbar w-[22px] max-tight:w-[28px] origin-bottom animate-bar-rise transition-[background-color] duration-[120ms] ease-[ease] ${
                    on
                      ? "bg-ink group-hover:bg-ink-soft"
                      : "border border-rule bg-ink-wash-strong group-hover:bg-ink-view-edge"
                  }`}
                  style={{ height, animationDelay: `${index * 70}ms` }}
                />
              </span>
              {/* The axis, and the pressed state, drawn once. A hairline under an
                  edition that is not on screen thickens to solid ink under one
                  that is, which joins the bar to its label into a single column
                  of ink — the same fill the box below has always used to say it
                  is on, now running the height of the control. */}
              <span className={`h-[2px] w-full ${on ? "bg-ink" : "border-t border-rule"}`} />
              <span
                className={`mt-[4px] border px-[7px] py-[3px] font-mono text-[11px] leading-none transition-[background-color,color] duration-[120ms] ease-[ease] ${
                  on
                    ? "border-ink bg-ink text-paper-raised group-hover:border-ink-soft group-hover:bg-ink-soft"
                    : "border-rule text-ink-soft group-hover:bg-ink-wash"
                }`}
              >
                {lang.toUpperCase()}
              </span>
            </button>
          );
        })}
      </div>

      {/* Same raised panel the legend's note is printed on, so the two read as
          one vocabulary of "something just opened" rather than two different
          UI patterns for the same kind of interruption. `role="status"` for the
          same reason: on a first article, nobody asked for this either. */}
      {open && (
        <div
          id="langbars-note"
          role="status"
          className="langbars-note absolute z-50 top-[calc(100%_+_10px)] start-0 w-[min(340px,calc(100vw_-_44px))] px-[15px] pt-[12px] pb-[14px] bg-paper-raised border border-ink rounded-[2px] shadow-offset text-ink animate-reveal-in"
        >
          <p className="m-0 mb-[8px] font-mono text-[11px] tracking-[0.09em] uppercase text-ink-soft">
            what the bars mean
          </p>
          <p className="m-0 text-[14px] leading-[1.6] text-ink-soft">
            Each bar&apos;s height is that edition&apos;s word count, so the tallest is the longest
            article. Click a language to bring its column on screen, or to put it away again.
          </p>
          <button
            type="button"
            className="langbars-note-ok mt-[13px] py-[6px] px-[14px] font-mono text-[12px] tracking-[0.04em] bg-ink text-paper-raised border border-ink transition-opacity duration-[120ms] ease-[ease] hover:opacity-[0.82]"
            onClick={close}
          >
            Got it
          </button>
        </div>
      )}
    </div>
  );
}
