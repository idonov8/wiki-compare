"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AlignedSentence, Claim, Lang } from "@/lib/types";

/** Long enough that sweeping the pointer across a paragraph doesn't flicker the
 *  panel through every sentence on the way. */
const SHOW_DELAY = 140;
/** Long enough to cross the gap between two sentences without the panel
 *  closing and reopening. */
const HIDE_DELAY = 180;
const WIDTH = 420;
const MARGIN = 10;

export interface Placement {
  /** "beside": next to the hovered column. "sheet": across the bottom of the
   *  screen, where there is no room beside it. */
  mode: "beside" | "sheet";
  left?: number;
  width?: number;
  top?: number;
  bottom?: number;
  maxHeight?: number;
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

/**
 * Beside the hovered column, over its neighbour when there is one: the
 * neighbour is another language, which is what the panel shows anyway. With no
 * room on either side, a sheet across the bottom of the screen.
 */
function place(element: HTMLElement): Placement {
  const sentence = element.getBoundingClientRect();
  const column = (element.closest("[data-edition]") ?? element).getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const width = Math.min(WIDTH, vw - 2 * MARGIN);

  let left: number | undefined;
  if (column.right + MARGIN + width <= vw) left = column.right + MARGIN;
  else if (column.left - MARGIN - width >= 0) left = column.left - MARGIN - width;
  if (left === undefined) return { mode: "sheet" };
  left = Math.max(MARGIN, Math.min(left, vw - width - MARGIN));

  // Below the sentence's top while there is room under it, otherwise above its
  // foot, so the panel never covers the text it is about.
  return sentence.top < vh * 0.6
    ? { mode: "beside", left, width, top: Math.max(MARGIN, sentence.top), maxHeight: vh - Math.max(MARGIN, sentence.top) - MARGIN }
    : { mode: "beside", left, width, bottom: vh - sentence.bottom, maxHeight: sentence.bottom - MARGIN };
}

/**
 * Which sentence the reader is pointing at, and where the panel showing its
 * counterparts goes.
 */
export function useCounterpart(
  rows: Map<string, { lang: Lang; row: AlignedSentence }>,
  claimAt: (key: string) => Claim | undefined,
) {
  const [state, setState] = useState<CounterpartState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pinned = useRef(false);

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
        pinned.current = how === "tap";
        setState({ key, ...found, claim: claimAt(key), pinned: how === "tap", place: place(element) });
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

  // A hover panel follows the pointer, not the page: scrolling moves the text
  // out from under it, so it goes. A pinned one stays until closed.
  useEffect(() => {
    if (!state || state.pinned) return;
    const onScroll = () => close();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
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
