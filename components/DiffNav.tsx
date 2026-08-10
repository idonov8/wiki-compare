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
 *  comparison, a toggled column, another difference streaming in — and forces a
 *  re-measure.
 *
 *  `busy` says the comparison is still running, and turns the controls into the
 *  progress indicator for it: an arc of ink travels the border, changing plate
 *  every revolution. It is the right thing to put a loader on because it is
 *  already reporting the work — the count climbs as differences are found, and
 *  the arrows step through the ones that have arrived while the rest are still
 *  being read. */
export default function DiffNav({ signature, busy = false }: { signature: string; busy?: boolean }) {
  const [ticks, setTicks] = useState<Tick[]>([]);
  const [view, setView] = useState({ top: 0, height: 100 });
  const [current, setCurrent] = useState(0);
  const marksRef = useRef<HTMLElement[]>([]);

  /** True for the length of the finishing animation, and only for a run that
   *  was actually watched finishing. A comparison served from the cache arrives
   *  complete and was never busy, so it has nothing to announce — it should sit
   *  there as though it had always been there. */
  const [settled, setSettled] = useState(false);
  const wasBusy = useRef(busy);

  useEffect(() => {
    const finishing = wasBusy.current && !busy;
    wasBusy.current = busy;
    if (!finishing) return;
    setSettled(true);
    // Comfortably past the longer of the two animations, so the attribute is
    // gone before anything could restart it.
    const t = setTimeout(() => setSettled(false), 900);
    return () => clearTimeout(t);
  }, [busy]);

  const measure = useCallback(() => {
    // Marks inside a collapsed <details> (the folded Key facts block) have no
    // client rects; leaving them in would pin ticks at the top of the rail and
    // send the arrows to something off screen. Re-measured when a block opens.
    const marks = [...document.querySelectorAll<HTMLElement>("mark.claim")].filter(
      (el) => el.getClientRects().length > 0,
    );
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
    // `toggle` doesn't bubble, so capture it to catch the Key facts block
    // opening or closing and re-plot its marks.
    const onToggle = () => onResize();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    document.addEventListener("toggle", onToggle, true);
    document.fonts?.ready.then(() => {
      measure();
      track();
    });
    return () => {
      clearTimeout(t);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("toggle", onToggle, true);
    };
  }, [signature, measure, track]);

  const jumpTo = (el: HTMLElement) => {
    const y = el.getBoundingClientRect().top + window.scrollY - SCROLL_OFFSET;
    window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    el.classList.remove("diff-flash", "animate-diff-flash");
    void el.offsetWidth; // restart the animation if the same mark is re-targeted
    el.classList.add("diff-flash", "animate-diff-flash");
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
      {/* The strip itself stays click-through so it doesn't eat clicks on the
          article underneath; the rail and the controls opt back in to
          pointer events since those are the parts meant to be clicked. */}
      <div
        className="diffnav pointer-events-none fixed inset-y-0 right-0 z-40 flex w-[26px] items-stretch max-cols:w-[18px]"
        aria-hidden="true"
      >
        {/* Click-through below `cols`, where the rail is a picture of where the
            differences are and nothing else. There it runs down the edge a
            thumb swipes from and the edge a right-to-left column's text ends
            at, and a scrubber that swallowed those would cost more than
            scrubbing is worth on a screen this size. */}
        <div
          className="diffnav-rail pointer-events-auto max-cols:pointer-events-none relative mt-[8px] mr-[4px] mb-[64px] ml-[4px] flex-1 cursor-pointer rounded-[5px] bg-ink-wash"
          onClick={onRailClick}
        >
          {/* The slice of the page currently on screen, so the rail doubles as a map of where the reader is. */}
          <div
            className="diffnav-view absolute right-0 left-0 min-h-[12px] rounded-[5px] border border-ink-view-edge bg-ink-view"
            style={{ top: `${view.top}%`, height: `${view.height}%` }}
          />
          {ticks.map((tick, i) => (
            <div
              key={i}
              className="diffnav-tick absolute -mt-[1.5px] h-[3px] right-[3px] left-[3px] rounded-[2px] transition-transform duration-100 ease-[ease] data-[type=contradiction]:bg-contradiction data-[type=unique]:bg-unique data-[type=framing]:bg-framing data-[current=true]:h-[4px] data-[current=true]:scale-x-[1.9]"
              data-type={tick.type}
              data-current={i === current}
              style={{ top: `${tick.pos * 100}%` }}
            />
          ))}
        </div>
      </div>
      <div
        // Lifted clear of the floating language switch below `cols`, which owns
        // the bottom of the viewport there.
        // The sweeping ring positions against this box directly: `fixed` is
        // already a positioned ancestor, and adding `relative` for it would not
        // stack — Tailwind emits both as `position`, and whichever it happens to
        // print last wins. `relative` won, and the pill stopped being fixed.
        className="diffnav-controls pointer-events-auto fixed right-[34px] bottom-[22px] z-[41] flex items-center gap-0.5 rounded-[3px] border border-ink bg-paper-raised p-1 font-mono text-[12px] shadow-offset max-cols:right-[14px] max-cols:bottom-[76px]"
        role="group"
        data-busy={busy}
        data-settled={settled}
        aria-label={
          busy ? "Jump between differences found so far; still reading" : "Jump between differences"
        }
      >
        <button
          className="h-[26px] w-[26px] border-0 bg-transparent text-[15px] leading-none text-ink hover:bg-ink-wash-strong"
          onClick={() => step(-1)}
          aria-label="Previous difference"
          title="Previous difference"
        >
          ↑
        </button>
        <span className="diffnav-count px-2 whitespace-nowrap text-ink-soft tabular-nums">
          <b className="font-semibold text-ink">{Math.min(current + 1, ticks.length)}</b> / {ticks.length}
        </span>
        <button
          className="h-[26px] w-[26px] border-0 bg-transparent text-[15px] leading-none text-ink hover:bg-ink-wash-strong"
          onClick={() => step(1)}
          aria-label="Next difference"
          title="Next difference"
        >
          ↓
        </button>
      </div>
    </>
  );
}
