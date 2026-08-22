import type { Claim } from "@/lib/types";

/** One Wikipedia article a search turned up, and the only thing needed to open
 *  a comparison of it. */
export interface Hit {
  lang: string;
  title: string;
  description?: string;
  url: string;
}

/**
 * A comparison costs tokens and about a minute, and every second of it is
 * wasted if the subject was wrong — so the article is chosen from search
 * results rather than guessed from the box. The choice starts the comparison
 * immediately, and the article itself is what fills the wait: it is fetched in
 * parallel and on screen within a second, so the reader can see they picked the
 * right page while the model is still reading it.
 */
export type Phase = "idle" | "results" | "comparing" | "done";

export interface CardState {
  claim: Claim;
  left: number;
  /** Exactly one of these is set: `bottom` anchors the card above the mark. */
  top?: number;
  bottom?: number;
}
