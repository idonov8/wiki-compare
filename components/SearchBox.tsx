"use client";

import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import { LANGS, LANG_META } from "@/lib/types";

/**
 * The one search field, at two sizes.
 *
 * The landing page puts a large one in the middle of the hero and the masthead
 * carries a small one once that has scrolled away — but they are the same
 * control over the same state, and writing them twice is how the placeholder in
 * one drifts from the placeholder in the other. The variant changes the metrics
 * and nothing else: same value, same submit, same disabled behaviour.
 *
 * Field, language stamp and submit are one printed box rather than three
 * controls in a row, which is what lets the focus ring be drawn inside that
 * box: the thing being focused is the whole search, and a ring standing off the
 * outside would sit over the hero's offset shadow on one page and over the
 * masthead's rule on the other.
 */

export type SearchVariant = "hero" | "bar";

interface Props {
  variant: SearchVariant;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  /** Set on whichever box is currently the page's primary one, so the two
   *  never both claim the same accessible name. */
  id?: string;
  className?: string;
}

const FIELD = {
  hero:
    "px-[18px] py-[15px] text-[17px] max-tight:px-[14px] max-tight:py-[13px] max-tight:text-[15px]",
  bar: "px-[12px] py-[9px]",
} as const;

const SUBMIT = {
  hero: "px-[24px] max-tight:px-[16px]",
  bar: "px-[16px]",
} as const;

const GLYPH = {
  hero: 20,
  bar: 16,
} as const;

const STAMP = {
  hero:
    "gap-[7px] px-[10px] py-[7px] me-[6px] text-[12px] tracking-[0.1em] max-tight:gap-[5px] max-tight:px-[6px] max-tight:me-[3px] max-tight:text-[11px] max-tight:tracking-[0.04em]",
  bar: "gap-[5px] px-[7px] py-[4px] me-[3px] text-[11px] tracking-[0.06em]",
} as const;

/**
 * The hero field wears the house signature — an offset hard shadow, the same
 * one the claim card and the checkout summary wear. It marks the live thing on
 * the page, and on the landing page the live thing is this.
 */
const SHELL = {
  hero: "border-ink shadow-offset",
  bar: "border-rule",
} as const;

function SearchGlyph({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.4 15.4 21 21" />
    </svg>
  );
}

/**
 * Which editions a search reads, stated rather than chosen.
 *
 * Wikipedia's own field carries a language picker in this corner, and a reader
 * arriving from it looks for one in the same place. This site has nothing to
 * pick: every comparison reads all three editions at once, which is the whole
 * product. So the stamp names the three, set in the utility face and the grey
 * of a caption rather than the ink of a control — it is a statement about the
 * search, not a fourth thing to operate. The chevron is what stays honest about
 * the panel behind it, which is the note about the editions that are not here
 * yet.
 */
function LanguageStamp({
  variant,
  open,
  panelId,
  onToggle,
}: {
  variant: SearchVariant;
  open: boolean;
  panelId: string;
  onToggle: () => void;
}) {
  const codes = LANGS.map((lang) => lang.toUpperCase()).join(" ");

  return (
    <button
      type="button"
      className={`langstamp flex flex-none items-center self-center rounded-[2px] font-mono text-ink-soft transition-[color,background-color] duration-[120ms] ease-[ease] hover:bg-ink-wash hover:text-ink focus-visible:[outline-offset:-2px] aria-expanded:bg-ink-wash aria-expanded:text-ink ${STAMP[variant]}`}
      aria-expanded={open}
      aria-controls={panelId}
      // Opens with the codes it prints, so "click EN HE AR" reaches it: a name
      // that only described the control would leave voice control with nothing
      // on screen to say.
      aria-label={`${codes} — the Wikipedia editions this searches`}
      onClick={onToggle}
    >
      {codes}
      <svg
        width="9"
        height="6"
        viewBox="0 0 10 6"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`transition-transform duration-[140ms] ease-[ease] ${open ? "rotate-180" : ""}`}
        aria-hidden="true"
      >
        <path d="m1 1 4 4 4-4" />
      </svg>
    </button>
  );
}

const SearchBox = forwardRef<HTMLInputElement, Props>(function SearchBox(
  { variant, value, onChange, onSubmit, busy, id, className = "" },
  ref,
) {
  // Two of these can be mounted at once — the hero's and the masthead's — so
  // the panel each stamp controls needs an id of its own.
  const panelId = useId();
  const [langOpen, setLangOpen] = useState(false);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!langOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLangOpen(false);
    };
    // `pointerdown` rather than `click`: a press that starts outside should
    // shut the panel before the field under it takes focus, so a reader who is
    // done with it and going straight for the input does both in one press.
    const onDown = (e: PointerEvent) => {
      if (!form.current?.contains(e.target as Node)) setLangOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [langOpen]);

  return (
    <form
      ref={form}
      className={`search relative ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      role="search"
    >
      <div
        className={`search-shell flex items-stretch rounded-[2px] border bg-paper-raised focus-within:[outline:2px_solid_var(--color-ink)] focus-within:[outline-offset:-2px] ${SHELL[variant]}`}
      >
        <input
          ref={ref}
          id={id}
          className={`min-w-0 flex-1 [font:inherit] border-0 bg-transparent text-inherit outline-none placeholder:text-ink-soft ${FIELD[variant]}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          // Short enough to survive a phone. The magnifier at the other end
          // already says what pressing does, so the placeholder is free to say
          // only what goes in the field.
          placeholder="Article title, or a Wikipedia URL"
          aria-label="Article title"
          autoComplete="off"
          spellCheck={false}
        />
        <LanguageStamp
          variant={variant}
          open={langOpen}
          panelId={panelId}
          onToggle={() => {
            // Only the opening is worth a row. Every one of these is somebody
            // looking for an edition this site does not read yet.
            if (!langOpen) track("language_menu_opened", { variant });
            setLangOpen((was) => !was);
          }}
        />
        {/* The masthead's only solid block of ink, and now with no word on it:
            a magnifier is what the eye looks for at the end of a search field,
            and "Search" beside a field the reader has just typed a title into
            was labelling the obvious. */}
        <button
          type="submit"
          className={`search-submit flex flex-none items-center justify-center rounded-e-[1px] border-s border-ink bg-ink text-paper-raised transition-opacity duration-[120ms] ease-[ease] hover:opacity-[0.85] focus-visible:[outline-color:var(--color-paper-raised)] focus-visible:[outline-offset:-4px] disabled:cursor-progress disabled:hover:opacity-100 ${SUBMIT[variant]}`}
          disabled={busy}
          aria-label={busy ? "Searching…" : "Search"}
        >
          {busy ? (
            // Full ink still, not the dimmed-out disabled look the word
            // "Working…" used to carry: the button is unpressable because it is
            // busy, and a turning loader says that where a grey block says the
            // search is off.
            <span
              className="block rounded-full border-[2px] border-paper-22 border-t-paper-raised animate-reveal-spin"
              style={{ width: GLYPH[variant], height: GLYPH[variant] }}
              aria-hidden="true"
            />
          ) : (
            <SearchGlyph size={GLYPH[variant]} />
          )}
        </button>
      </div>

      {langOpen && (
        // Anchored to the trailing corner of the box rather than to the stamp,
        // so it tucks under the search rather than hanging out of the middle of
        // it. Raised paper with the offset shadow, like every other panel that
        // opens on this site. `role="status"` because focus stays on the stamp
        // and nothing in here can take it — this is a sentence, not a menu, so
        // it is announced where it stands.
        <div
          id={panelId}
          role="status"
          className="langstamp-note absolute z-50 top-[calc(100%_+_10px)] end-0 w-[min(320px,calc(100vw_-_48px))] rounded-[2px] border border-ink bg-paper-raised px-[15px] pt-[12px] pb-[13px] text-start font-body text-[13px] leading-[1.55] tracking-normal text-ink shadow-offset animate-reveal-in"
        >
          <p className="m-0 font-semibold">More languages coming soon.</p>
          <p className="mt-[6px] mb-0 text-ink-soft">
            Every search reads all three editions at once:{" "}
            {LANGS.map((lang) => LANG_META[lang].label).join(", ")}.
          </p>
        </div>
      )}
    </form>
  );
});

export default SearchBox;
