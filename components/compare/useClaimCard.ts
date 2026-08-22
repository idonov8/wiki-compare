"use client";

import { useCallback, useEffect, useState } from "react";
import type { CardState } from "./types";
import type { Claim } from "@/lib/types";

/** The card's widest, which it takes unless the viewport is narrower. */
const CARD_WIDTH = 340;
const CARD_MARGIN = 8;
/** Enough room to place the card below a mark without it running off-screen. */
const CARD_CLEARANCE = 190;

/** The hover card for a mark, and where on screen it goes. */
export function useClaimCard() {
  const [card, setCard] = useState<CardState | null>(null);

  const hide = useCallback(() => setCard(null), []);

  const show = useCallback((claim: Claim, event: React.MouseEvent | React.FocusEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();

    // Clamp both edges. Clamping only the right edge pushed the card off-screen
    // for a mark near the left of the viewport, which the rightmost column makes
    // likelier once it is the only one shown. The width is the card's own only
    // while the viewport can hold it — on a phone the card is as wide as the
    // screen allows, and clamping against 340 there pinned every card to the
    // left margin.
    const width = Math.min(CARD_WIDTH, window.innerWidth - CARD_MARGIN * 2);
    const left = Math.max(
      CARD_MARGIN,
      Math.min(rect.left, window.innerWidth - width - CARD_MARGIN),
    );

    // Anchoring by `bottom` when flipping is what makes the flip real: setting
    // `top` to just above the mark still lays the card out downwards, so it
    // covered the very text it was explaining. This needs no height measurement.
    const flip = rect.bottom + CARD_CLEARANCE > window.innerHeight;
    setCard(
      flip
        ? { claim, left, bottom: window.innerHeight - rect.top + CARD_MARGIN }
        : { claim, left, top: rect.bottom + CARD_MARGIN },
    );
  }, []);

  // A card reached by keyboard needs a way out that isn't Tab. Blur alone leaves
  // someone who opened it with focus no way to dismiss it in place.
  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCard(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card]);

  return { card, show, hide };
}
