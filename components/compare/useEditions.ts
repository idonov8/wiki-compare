"use client";

import { useEffect, useMemo, useState } from "react";
import { useNarrow } from "../useNarrow";
import { useSwipe } from "../useSwipe";
import type { Hit } from "./types";
import { LANGS, type ArticleSnapshot, type Lang } from "@/lib/types";

/**
 * Which editions are on screen, and how the reader changes that.
 *
 * Two questions, deliberately kept apart: which editions to set beside each
 * other, and which single one to be reading where three columns do not fit. A
 * phone rotated into landscape should find the desktop answer where it left it,
 * and `active` should survive opening another article — following a link out of
 * the Arabic column ought to land in Arabic.
 */
export function useEditions({
  articles,
  article,
  onSwitch,
}: {
  articles: Record<string, ArticleSnapshot>;
  /** The article being read. A new one restores every column the reader had
   *  hidden — the choice was about the subject they have now left. */
  article: Hit | null;
  /** Run when the language being read changes. The claim card goes with the
   *  column that raised it: its mark is about to be unmounted, and a tooltip
   *  outliving the text it points at is worse than no tooltip. */
  onSwitch: () => void;
}) {
  const [shown, setShown] = useState<Lang[]>([...LANGS]);
  const [active, setActive] = useState<Lang>("en");
  /** Which way the last language change moved, so the incoming column enters
   *  from the side the reader pulled it in from. */
  const [enterFrom, setEnterFrom] = useState(0);
  const narrow = useNarrow();

  useEffect(() => {
    setShown([...LANGS]);
  }, [article]);

  const available = useMemo(() => LANGS.filter((l) => articles[l]), [articles]);
  /** `active` can name an edition this subject doesn't have; the first one it
   *  does have is the fallback. */
  const solo = available.includes(active) ? active : available[0];
  const visible = narrow ? (solo ? [solo] : []) : shown.filter((l) => available.includes(l));

  const readIn = (lang: Lang) => {
    if (!solo || lang === solo) return;
    setEnterFrom(available.indexOf(lang) > available.indexOf(solo) ? 1 : -1);
    setActive(lang);
    onSwitch();
  };

  const toggle = (lang: Lang) =>
    setShown((current) =>
      current.includes(lang)
        ? current.length > 1
          ? current.filter((l) => l !== lang)
          : current
        : [...current, lang].sort((a, b) => LANGS.indexOf(a) - LANGS.indexOf(b)),
    );

  // Clamped rather than wrapped: with the switch on screen showing where in the
  // three you are, a flick off the end that reappeared at the other end would
  // read as having lost your place.
  const swipe = useSwipe((direction) => {
    if (!solo) return;
    const next = available[available.indexOf(solo) + direction];
    if (next) readIn(next);
  });

  return {
    available,
    visible,
    solo,
    /** The language the reader last chose, whether or not this subject has it —
     *  what the skeleton draws before any article has arrived. */
    active,
    narrow,
    enterFrom,
    /** The single move behind both the floating switch and the swipe, which is
     *  what keeps them saying the same thing. */
    readIn,
    toggle,
    swipe,
  };
}
