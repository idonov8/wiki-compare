"use client";

import { useEffect, useRef, useState } from "react";
import { sentenceKey } from "./useCounterpart";
import { track } from "@/lib/analytics";
import type { AlignedSentence, Lang } from "@/lib/types";

/** Selection changes arrive with every character a drag passes over. */
const SETTLE = 80;

const NONE = new Set<string>();

/**
 * The sentences in the other languages that correspond to whatever the reader
 * has selected in one column: the matched sentence where Jev found one, the
 * matched paragraph's sentences where it found only the paragraph.
 */
export function useSelectionEcho(
  rows: Map<string, { lang: Lang; row: AlignedSentence }>,
  paragraphs: Map<string, string[]>,
): Set<string> {
  const [echo, setEcho] = useState<Set<string>>(NONE);
  const reported = useRef("");

  useEffect(() => {
    if (!rows.size) return;
    let timer: ReturnType<typeof setTimeout>;
    const read = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) {
        setEcho(NONE);
        return;
      }
      const range = selection.getRangeAt(0);
      const anchor = range.commonAncestorContainer;
      const column = (anchor instanceof Element ? anchor : anchor.parentElement)?.closest<HTMLElement>("[data-edition]");
      if (!column) {
        setEcho(NONE);
        return;
      }
      const out = new Set<string>();
      const from: string[] = [];
      for (const span of column.querySelectorAll<HTMLElement>("span.sentence[data-sentence]")) {
        if (!range.intersectsNode(span)) continue;
        const found = rows.get(span.dataset.sentence!);
        if (!found) continue;
        from.push(span.dataset.sentence!);
        for (const [lang, counterpart] of Object.entries(found.row.to) as [Lang, AlignedSentence["to"][Lang]][]) {
          if (!counterpart) continue;
          const { sentence, paragraph } = counterpart;
          if (sentence) out.add(sentenceKey(lang, sentence.section, sentence.start));
          else for (const key of paragraphs.get(sentenceKey(lang, paragraph.section, paragraph.start)) ?? []) out.add(key);
        }
      }
      setEcho(out.size ? out : NONE);
      const signature = from.join(",");
      if (out.size && signature !== reported.current) {
        reported.current = signature;
        void track("selection_echoed", { lang: column.dataset.edition, sentences: from.length, matches: out.size });
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
  }, [rows, paragraphs]);

  return echo;
}
