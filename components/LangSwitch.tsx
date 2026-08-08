"use client";

import { LANG_META, type Lang } from "@/lib/types";

/**
 * Which language the article is being read in, on a screen that can only show
 * one at a time.
 *
 * It floats over the article instead of joining the toggles in the controls
 * strip, because the strip is at the top of a page the reader spends scrolled
 * into the middle of: the wish to see this passage in another language arrives
 * while reading that passage, and the control has to be under the thumb at that
 * moment rather than a scroll away.
 *
 * It is a display of the same state the swipe moves, not a second source of it,
 * so the two can never disagree — pressing a name here and flicking the article
 * across are the same action written twice.
 */
export default function LangSwitch({
  langs,
  active,
  onChange,
}: {
  langs: Lang[];
  active: Lang;
  onChange: (lang: Lang) => void;
}) {
  // One language is not a choice, and a control offering none is just something
  // else covering the last line of the article.
  if (langs.length < 2) return null;

  return (
    <div
      className="langswitch fixed bottom-[18px] left-1/2 z-[46] flex -translate-x-1/2 gap-[3px] rounded-full border border-ink bg-paper-raised p-[4px] shadow-offset"
      role="group"
      aria-label="Reading language"
    >
      {langs.map((lang) => (
        // Each name is set in its own script and marked with its own `lang`, so
        // the control names the languages rather than abbreviating them into
        // codes — on a phone this is the whole language interface, and EN/HE/AR
        // is a legend for columns that are no longer side by side to compare.
        <button
          key={lang}
          className="langswitch-option rounded-full px-[14px] py-[7px] text-[13px] leading-none text-ink-soft transition-[background-color,color] duration-[120ms] ease-[ease] aria-pressed:bg-ink aria-pressed:text-paper-raised"
          aria-pressed={lang === active}
          aria-label={LANG_META[lang].label}
          lang={lang}
          onClick={() => onChange(lang)}
        >
          {LANG_META[lang].native}
        </button>
      ))}
    </div>
  );
}
