"use client";

import { useEffect, useState } from "react";

/**
 * True on a screen too narrow to stand the three columns side by side.
 *
 * The width is `--breakpoint-cols` from globals.css, written out again because a
 * media query string cannot read a Tailwind token — the `max-cols:` utilities
 * and this hook have to be changed together. It is the same line either way:
 * above it the page is a comparison you read across, below it a comparison you
 * read one language at a time.
 */
const NARROW = "(width < 861px)";

export function useNarrow(): boolean {
  // False through the server render and the first client render, so hydration
  // sees the markup it was sent. Nothing that depends on this is on screen that
  // early: the columns only exist once an article has been fetched.
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(NARROW);
    const apply = () => setNarrow(query.matches);
    apply();
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, []);

  return narrow;
}
