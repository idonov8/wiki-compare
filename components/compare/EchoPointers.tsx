"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { track } from "@/lib/analytics";
import { LANG_META, type Lang } from "@/lib/types";

interface Pointer {
  lang: Lang;
  /** Whether the matching text is above the screen or below it. */
  up: boolean;
  left: number;
  width: number;
  target: HTMLElement;
}

/**
 * The columns scroll together, so the sentences matching a selection are as
 * often off the screen as on it. For each column whose match is out of sight, a
 * pointer at that edge of the column says which way it is and goes there.
 */
export default function EchoPointers({ echo }: { echo: Set<string> }) {
  const [pointers, setPointers] = useState<Pointer[]>([]);

  useEffect(() => {
    if (!echo.size) {
      setPointers([]);
      return;
    }
    const measure = () => {
      const vh = window.innerHeight;
      const byLang = new Map<Lang, HTMLElement[]>();
      for (const el of document.querySelectorAll<HTMLElement>('span.sentence[data-echo="true"]')) {
        const lang = el.closest<HTMLElement>("[data-edition]")?.dataset.edition as Lang | undefined;
        if (lang) byLang.set(lang, [...(byLang.get(lang) ?? []), el]);
      }
      const out: Pointer[] = [];
      for (const [lang, spans] of byLang) {
        const rects = spans.map((el) => el.getBoundingClientRect());
        if (rects.some((r) => r.bottom > 0 && r.top < vh)) continue;
        const column = spans[0].closest<HTMLElement>("[data-edition]")!.getBoundingClientRect();
        const up = rects[0].bottom <= 0;
        out.push({ lang, up, left: column.left, width: column.width, target: spans[0] });
      }
      setPointers(out);
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [echo]);

  if (!pointers.length) return null;
  return createPortal(
    <>
      {pointers.map((p) => (
        <div
          key={p.lang}
          className="echo-pointer fixed z-40 flex justify-center pointer-events-none"
          style={{ left: p.left, width: p.width, [p.up ? "top" : "bottom"]: 12 }}
        >
          <button
            type="button"
            className="pointer-events-auto px-[10px] py-[4px] font-mono text-[11px] bg-echo border border-echo-edge rounded-full shadow-offset-soft text-ink cursor-pointer"
            // Pressing must not end the selection that the pointer belongs to.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              void track("echo_pointer_followed", { lang: p.lang, up: p.up });
              p.target.scrollIntoView({ block: "center", behavior: "smooth" });
            }}
          >
            {p.up ? "↑" : "↓"} matching {LANG_META[p.lang].label} text {p.up ? "above" : "below"}
          </button>
        </div>
      ))}
    </>,
    document.body,
  );
}
