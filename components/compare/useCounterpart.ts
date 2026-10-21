"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NARROW } from "../useNarrow";
import type { Selected } from "./useSelection";
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
/** Room the card needs before it will sit on one side of the paragraph rather
 *  than beside the sentence itself. */
const CARD_ROOM = 220;
/** The least a passage is cut to when its paragraph starts low on the screen. */
const MIN_PASSAGE = 160;

/** In page coordinates, so a pinned passage scrolls with the text it sits by. */
export interface Box {
  left: number;
  width: number;
  top: number;
  /** As much of the screen as is left from `top`, so nothing runs off it. */
  maxHeight: number;
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
  /** Every sentence the reader has selected text in, when that is what opened
   *  the passages rather than a pointer. */
  selection?: AlignedSentence[];
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
 * The card goes on whichever side of the paragraph has room for it, under it
 * by preference; a paragraph taller than the screen leaves room on neither, and
 * then the card goes on the roomier side of the sentence itself. Either way it
 * is given exactly the screen left on that side.
 */
function cardSide(
  paragraph: { top: number; bottom: number },
  sentence: { top: number; bottom: number },
  vh: number,
): { above: boolean; edge: number; room: number } {
  const under = vh - paragraph.bottom - MARGIN;
  const over = paragraph.top - MARGIN;
  if (under >= CARD_ROOM) return { above: false, edge: paragraph.bottom, room: under };
  if (over >= CARD_ROOM) return { above: true, edge: paragraph.top, room: over };
  const below = vh - sentence.bottom - MARGIN;
  const above = sentence.top - MARGIN;
  return below >= above
    ? { above: false, edge: sentence.bottom, room: Math.max(below - MARGIN, 0) }
    : { above: true, edge: sentence.top, room: Math.max(above - MARGIN, 0) };
}

/**
 * Each other language's passage over that language's column, starting level
 * with the paragraph's first line (or the top of the screen, for a paragraph
 * that starts above it), and the card in the paragraph's own column, beside it.
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

  const start = Math.max(top, MARGIN);
  const overlays: Placement["overlays"] = {};
  for (const other of others) {
    const beside = band.querySelector<HTMLElement>(`[data-edition="${other}"]`);
    if (beside && beside !== column) {
      overlays[other] = {
        ...textBox(beside),
        top: start + window.scrollY,
        maxHeight: Math.max(vh - start - MARGIN, MIN_PASSAGE),
      };
    }
  }

  const side = cardSide({ top, bottom }, element.getBoundingClientRect(), vh);
  return {
    mode: "inline",
    overlays,
    card: {
      ...textBox(column),
      top: (side.above ? side.edge - MARGIN : side.edge + MARGIN) + window.scrollY,
      maxHeight: side.room,
      above: side.above,
    },
  };
}

/**
 * Which sentence the reader is pointing at, and where its counterparts and its
 * explanation go.
 */
export function useCounterpart(
  rows: Map<string, { lang: Lang; row: AlignedSentence }>,
  paragraphs: Map<string, string[]>,
  claimAt: (key: string) => Claim | undefined,
) {
  const [state, setState] = useState<CounterpartState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** What holds the passages open past the pointer leaving. */
  const held = useRef<"tap" | "selection" | null>(null);

  const close = useCallback(() => {
    clearTimeout(timer.current);
    held.current = null;
    setState(null);
  }, []);

  const show = useCallback(
    (key: string, element: HTMLElement, how: "hover" | "tap") => {
      const found = rows.get(key);
      // Pointing opens only a marked difference; any other text shows its
      // counterparts when selected.
      if (!found || !claimAt(key)) return;
      if (how === "hover" && held.current) return;
      // While text is selected the passages show the selection, and the click
      // that ends a drag is not a tap.
      if (!window.getSelection()?.isCollapsed) return;
      clearTimeout(timer.current);
      const open = () => {
        const { lang, row } = found;
        const claim = claimAt(key);
        const paragraph = paragraphs.get(sentenceKey(lang, row.section, row.paragraph.start)) ?? [key];
        const placement = place(element, paragraph, Object.keys(row.to) as Lang[]);
        held.current = how === "tap" ? "tap" : null;
        setState({ key, lang, row, claim, pinned: how === "tap", place: placement });
      };
      if (how === "tap") open();
      else timer.current = setTimeout(open, SHOW_DELAY);
    },
    [rows, paragraphs, claimAt],
  );

  /** Passages for a selection: level with its first line, each other language's
   *  matches picked out. Not on a narrow screen, which has no room beside it. */
  const select = useCallback(
    (selected: Selected | null) => {
      if (!selected) {
        if (held.current === "selection") close();
        return;
      }
      const selection = selected.keys.map((key) => rows.get(key)!.row);
      const others = [...new Set(selection.flatMap((row) => Object.keys(row.to) as Lang[]))];
      const placement = place(selected.element, selected.keys, others);
      if (placement.mode === "sheet") return;
      clearTimeout(timer.current);
      held.current = "selection";
      setState({
        key: `selection:${selected.keys.join(",")}`,
        lang: selected.lang,
        row: selection[0],
        selection,
        pinned: false,
        place: placement,
      });
    },
    [rows, close],
  );

  const leave = useCallback(() => {
    if (held.current) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(null), HIDE_DELAY);
  }, []);

  // A hover follows the pointer, not the page: scrolling moves the text out
  // from under it, so it goes. A pinned one or a selection's scrolls with the
  // text it sits by. A resize moves the columns out from under all of them.
  useEffect(() => {
    if (!state) return;
    const onScroll = () => !held.current && close();
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

  return { counterpart: state, show, select, leave, close };
}
