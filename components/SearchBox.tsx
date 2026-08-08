"use client";

import { forwardRef } from "react";

/**
 * The one search field, at two sizes.
 *
 * The landing page puts a large one in the middle of the hero and the masthead
 * carries a small one once that has scrolled away — but they are the same
 * control over the same state, and writing them twice is how the placeholder in
 * one drifts from the placeholder in the other. The variant changes the metrics
 * and nothing else: same value, same submit, same disabled behaviour.
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
  hero:
    "px-[26px] py-[15px] text-[15px] tracking-[0.02em] max-tight:px-[16px] max-tight:py-[13px]",
  bar: "px-[18px] py-[9px]",
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

const SearchBox = forwardRef<HTMLInputElement, Props>(function SearchBox(
  { variant, value, onChange, onSubmit, busy, id, className = "" },
  ref,
) {
  return (
    <form
      className={`search flex ${variant === "hero" ? "gap-0" : "gap-2"} ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      role="search"
    >
      <input
        ref={ref}
        id={id}
        className={`flex-1 min-w-0 [font:inherit] bg-paper-raised border ${SHELL[variant]} rounded-[2px] ${
          variant === "hero" ? "rounded-e-none border-e-0" : ""
        } text-inherit placeholder:text-ink-soft ${FIELD[variant]}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Article title, or paste a Wikipedia URL"
        aria-label="Article title"
        autoComplete="off"
        spellCheck={false}
      />
      <button
        type="submit"
        className={`shrink-0 bg-ink text-paper-raised border border-ink ${SHELL[variant]} ${
          variant === "hero" ? "rounded-s-none" : ""
        } disabled:opacity-[0.45] disabled:cursor-progress ${SUBMIT[variant]}`}
        disabled={busy}
      >
        {busy ? "Working…" : "Search"}
      </button>
    </form>
  );
});

export default SearchBox;
