"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Tick {
  type: string;
  /** Fraction (0–1) of the page height at the mark's centre. */
  pos: number;
  /** Absolute Y of the mark's centre, for scrolling to it. */
  y: number;
}

/** Leave the sticky-free top a little clear so a jumped-to mark isn't flush
 *  against the viewport edge. */
const SCROLL_OFFSET = 96;

/** A right-edge rail that plots every highlight against the length of the page,
 *  plus arrows that step through them in reading order. It reads the marks out
 *  of the DOM rather than the claim list because a claim can surface as several
 *  marks (once per language, once per occurrence), and it is those positions a
 *  reader wants to jump between.
 *
 *  `signature` changes whenever the rendered set of marks might have — a new
 *  comparison, a toggled column — and forces a re-measure. */
export default function DiffNav({ signature }: { signature: string }) {
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [view, setView] = useState({ top: 0, height: 100 });
  const [current, setCurrent] = useState(0);
  const marksRef = useRef<HTMLElement[]>([]);

  const measure = useCallback(() => {
    const marks = [...document.querySelectorAll<HTMLElement>("mark.claim")];
    marks.sort((a, b) => {
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      return ra.top - rb.top || ra.left - rb.left;
    });
    const docH = document.documentElement.scrollHeight || 1;
    marksRef.current = marks;
    setTicks(
      marks.map((el) => {
        const r = el.getBoundingClientRect();
        const y = r.top + window.scrollY + r.height / 2;
        return { type: el.dataset.type ?? "", pos: y / docH, y };
      }),
    );
  }, []);

  const track = useCallback(() => {
    const docH = document.documentElement.scrollHeight || 1;
    setView({
      top: (window.scrollY / docH) * 100,
      height: (window.innerHeight / docH) * 100,
    });
    const mid = window.scrollY + window.innerHeight / 2;
    const marks = marksRef.current;
    if (!marks.length) return;
    let nearest = 0;
    let best = Infinity;
    marks.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const d = Math.abs(r.top + window.scrollY + r.height / 2 - mid);
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    setCurrent(nearest);
  }, []);

  // Fonts load after first paint and shift every position, so measure again
  // once they settle rather than trusting the first layout.
  useEffect(() => {
    measure();
    track();
    const t = setTimeout(() => {
      measure();
      track();
    }, 400);
    const onScroll = () => track();
    const onResize = () => {
      measure();
      track();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    document.fonts?.ready.then(() => {
      measure();
      track();
    });
    return () => {
      clearTimeout(t);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [signature, measure, track]);

  const jumpTo = (el: HTMLElement) => {
    const y = el.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    el.classList.remove("diff-flash");
    void el.offsetWidth; // restart the animation if the same mark is re-targeted
    el.classList.add("diff-flash");
  };

  const step = (dir: 1 | -1) => {
    const marks = marksRef.current;
    if (!marks.length) return;
    const mid = window.scrollY + window.innerHeight / 2;
    const centre = (el: HTMLElement) =>
      el.getBoundingClientRect().top + window.scrollY + el.getBoundingClientRect().height / 2;
    let target: HTMLElement | undefined;
    if (dir === 1) target = marks.find((el) => centre(el) > mid + 4) ?? marks[0];
    else target = [...marks].reverse().find((el) => centre(el) < mid - 4) ?? marks[marks.length - 1];
    jumpTo(target);
  };

  const onRailClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rail = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientY - rail.top) / rail.height;
    const docH = document.documentElement.scrollHeight;
    window.scrollTo({ top: frac * docH - window.innerHeight / 2, behavior: "smooth" });
  };

  if (!ticks.length) return null;

  return (
    <>
      <div className="diffnav" aria-hidden="true">
        <div className="diffnav-rail" onClick={onRailClick}>
          <div className="diffnav-view" style={{ top: `${view.top}%`, height: `${view.height}%` }} />
          {ticks.map((tick, i) => (
            <div
              key={i}
              className="diffnav-tick"
              data-type={tick.type}
              data-current={i === current}
              style={{ top: `${tick.pos * 100}%` }}
            />
          ))}
        </div>
      </div>
      <div className="diffnav-controls" role="group" aria-label="Jump between differences">
        <button onClick={() => step(-1)} aria-label="Previous difference" title="Previous difference">
          ↑
        </button>
        <span className="diffnav-count">
          <b>{Math.min(current + 1, ticks.length)}</b> / {ticks.length}
        </span>
        <button onClick={() => step(1)} aria-label="Next difference" title="Next difference">
          ↓
        </button>
      </div>
    </>
  );
}
