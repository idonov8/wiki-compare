"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/analytics";
import type { AlignedSentence, Lang } from "@/lib/types";

/** Selection changes arrive with every character a drag passes over. */
const SETTLE = 80;

export interface Selected {
  lang: Lang;
  /** The selected sentences' keys, in reading order. */
  keys: string[];
  /** The first selected sentence, to place the passages by. */
  element: HTMLElement;
}

/** The aligned sentences the reader has selected text in, within one column. */
export function useSelection(rows: Map<string, { lang: Lang; row: AlignedSentence }>): Selected | null {
  const [selected, setSelected] = useState<Selected | null>(null);
  const reported = useRef("");

  useEffect(() => {
    if (!rows.size) return;
    let timer: ReturnType<typeof setTimeout>;
    const read = () => {
      const selection = window.getSelection();
      const range = selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0) : null;
      const anchor = range?.commonAncestorContainer;
      const column = anchor && (anchor instanceof Element ? anchor : anchor.parentElement)?.closest<HTMLElement>("[data-edition]");
      const spans = column
        ? [...column.querySelectorAll<HTMLElement>("span.sentence[data-sentence]")].filter(
            (span) => range!.intersectsNode(span) && rows.has(span.dataset.sentence!),
          )
        : [];
      if (!column || !spans.length) {
        setSelected((was) => (was ? null : was));
        return;
      }
      const keys = spans.map((span) => span.dataset.sentence!);
      const signature = keys.join(",");
      setSelected((was) => (was?.keys.join(",") === signature ? was : { lang: column.dataset.edition as Lang, keys, element: spans[0] }));
      if (signature !== reported.current) {
        reported.current = signature;
        void track("selection_echoed", { lang: column.dataset.edition, sentences: keys.length });
      }
    };
    const onChange = () => {
      clearTimeout(timer);
      timer = setTimeout(read, SETTLE);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", onChange);
    };
  }, [rows]);

  return selected;
}
