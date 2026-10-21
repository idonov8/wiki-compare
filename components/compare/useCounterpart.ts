"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NARROW } from "../useNarrow";
import type { AlignedSentence, Claim, Lang } from "@/lib/types";

/** Long enough that sweeping the pointer across a paragraph doesn't flicker the
 *  passages through every sentence on the way. */
const SHOW_DELAY = 140;
/** Long enough to cross the gap between two sentences without the passages
 *  closing and reopening. */
const HIDE_DELAY = 180;
const MARGIN = 10;
/** How far a passage spills past the text of the column it covers, so it hides
 *  the text under it with room to spare. */
const BLEED = 10;
/** A paragraph ending lower than this share of the screen gets its card above
 *  it, where there is room to read it. */
const LOW = 0.62;

/** In page coordinates, so a pinned passage scrolls with the text it sits by. */
export interface Box {
  left: number;
  width: number;
  top: number;
}

export interface Placement {
  /** "inline": each other language's passage laid over its own column, level
   *  with the paragraph, and the difference explained under the paragraph.
   *  "sheet": one column on screen, so the explanation alone, across the foot. */
  mode: "inline" | "sheet";
  overlays: Partial<Record<Lang, Box>>;
  card?: Box & { above: boolean };
}

export interface CounterpartState {
  key: string;
  lang: Lang;
  row: AlignedSentence;
  claim?: Claim;
  /** Opened by a click or a tap: stays until closed, and can be scrolled. */
  pinned: boolean;
  place: Placement;
}

export const sentenceKey = (lang: Lang, section: number, start: number) => `${lang}:${section}:${start}`;

function textBox(column: HTMLElement): { left: number; width: number } {
  const rect = column.getBoundingClientRect();
  const style = getComputedStyle(column);
  const left = rect.left + parseFloat(style.paddingLeft);
  const right = rect.right - parseFloat(style.paddingRight);
  return { left: left + window.scrollX - BLEED, width: right - left + 2 * BLEED };
}

/**
 * Each other language's passage over that language's column, starting level
 * with the paragraph's first line (or the top of the screen, for a paragraph
 * that starts above it), and the card in the paragraph's own column, under it.
 * A language whose column is not beside this one has no box, and the card
 * carries its passage instead.
 */
function place(element: HTMLElement, paragraph: string[], others: Lang[]): Placement {
  if (window.matchMedia(NARROW).matches) return { mode: "sheet", overlays: {} };
  const column = element.closest<HTMLElement>("[data-edition]");
  if (!column) return { mode: "sheet", overlays: {} };
  const band = element.closest<HTMLElement>("[data-band]") ?? document.body;

  const spans = paragraph
    .map((key) => column.querySelector<HTMLElement>(`[data-sentence="${key}"]`))
    .filter((el): el is HTMLElement => !!el);
  const top = (spans[0] ?? element).getBoundingClientRect().top;
  const bottom = (spans[spans.length - 1] ?? element).getBoundingClientRect().bottom;
  const vh = window.innerHeight;

  const overlays: Placement["overlays"] = {};
  for (const other of others) {
    const beside = band.querySelector<HTMLElement>(`[data-edition="${other}"]`);
    if (beside && beside !== column) {
      overlays[other] = { ...textBox(beside), top: Math.max(top, MARGIN) + window.scrollY };
    }
  }

  const above = bottom > vh * LOW && top > vh * (1 - LOW);
  return {
    mode: "inline",
    overlays,
    card: {
      ...textBox(column),
      top: (above ? top - MARGIN : bottom + MARGIN) + window.scrollY,
      above,
    },
  };
}

/**
 * Which sentence the reader is pointing at, and where its counterparts and its
 * explanation go.
 */
export function useCounterpart(
  rows: Map<string, { lang: Lang; row: AlignedSentence }>,
  claimAt: (key: string) => Claim | undefined,
) {
  const [state, setState] = useState<CounterpartState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pinned = useRef(false);

  /** Every sentence's paragraph, as the keys of the sentences in it. */
  const paragraphs = useRef(new Map<string, string[]>());
  useEffect(() => {
    const out = new Map<string, string[]>();
    for (const [key, { lang, row }] of rows) {
      const id = sentenceKey(lang, row.section, row.paragraph.start);
      out.set(id, [...(out.get(id) ?? []), key]);
    }
    paragraphs.current = out;
  }, [rows]);

  const close = useCallback(() => {
    clearTimeout(timer.current);
    pinned.current = false;
    setState(null);
  }, []);

  const show = useCallback(
    (key: string, element: HTMLElement, how: "hover" | "tap") => {
      const found = rows.get(key);
      if (!found) return;
      if (how === "hover" && pinned.current) return;
      clearTimeout(timer.current);
      const open = () => {
        const { lang, row } = found;
        const claim = claimAt(key);
        const paragraph = paragraphs.current.get(sentenceKey(lang, row.section, row.paragraph.start)) ?? [key];
        const placement = place(element, paragraph, Object.keys(row.to) as Lang[]);
        // A narrow screen shows only the explanation, so a sentence without a
        // difference has nothing to open.
        if (placement.mode === "sheet" && !claim) {
          pinned.current = false;
          setState(null);
          return;
        }
        pinned.current = how === "tap";
        setState({ key, lang, row, claim, pinned: how === "tap", place: placement });
      };
      if (how === "tap") open();
      else timer.current = setTimeout(open, SHOW_DELAY);
    },
    [rows, claimAt],
  );

  const leave = useCallback(() => {
    if (pinned.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(null), HIDE_DELAY);
  }, []);

  // A hover follows the pointer, not the page: scrolling moves the text out
  // from under it, so it goes. A pinned one scrolls with the text it sits by.
  // A resize moves the columns out from under both.
  useEffect(() => {
    if (!state) return;
    const onScroll = () => !state.pinned && close();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", close);
    };
  }, [state, close]);

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, close]);

  useEffect(() => () => clearTimeout(timer.current), []);

  return { counterpart: state, show, leave, close };
}
