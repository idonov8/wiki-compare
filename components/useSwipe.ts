"use client";

import { useRef } from "react";

/** Far enough across to be meant, and clearly flatter than a scroll. A page of
 *  Wikipedia is read by dragging it up and down, so the test that matters is not
 *  how far the finger went but how much of that was sideways. */
const DISTANCE = 56;
const FLATNESS = 1.4;

/**
 * A horizontal flick over the article, as the handlers to spread onto whatever
 * it should be flicked over. `1` is a swipe towards the start of the screen —
 * the gesture for "bring the next one in from the right".
 *
 * Nothing is prevented and nothing follows the finger: vertical scrolling has to
 * stay exactly as native as it was, and a gesture that stole it halfway through
 * would cost a reader far more than the swipe is worth.
 */
export function useSwipe(onSwipe: (direction: 1 | -1) => void) {
  const from = useRef<{ x: number; y: number } | null>(null);

  return {
    onTouchStart: (e: React.TouchEvent) => {
      from.current =
        e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    },
    // A second finger means a pinch, and a pinch is not a swipe however it ends.
    onTouchMove: (e: React.TouchEvent) => {
      if (e.touches.length > 1) from.current = null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      const start = from.current;
      const touch = e.changedTouches[0];
      from.current = null;
      if (!start || !touch) return;
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;
      if (Math.abs(dx) < DISTANCE || Math.abs(dx) < Math.abs(dy) * FLATNESS) return;
      onSwipe(dx < 0 ? 1 : -1);
    },
  };
}
