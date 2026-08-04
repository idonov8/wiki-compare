/**
 * Phrases for the drifting marks shown while a comparison runs.
 *
 * Placement is derived from the text with a small LCG rather than `Math.random`,
 * so the server and the client agree and nothing jumps on hydration, and the
 * movement itself is left to CSS: each mark fades in and out on its own
 * staggered cycle, so no timer re-renders a wall of text every second.
 */
export function ghostRanges(text: string, limit = 4): { start: number; end: number; seed: number }[] {
  const words = [...text.matchAll(/\S+/g)];
  const out: { start: number; end: number; seed: number }[] = [];
  let seed = text.length * 7919 + words.length;

  for (let i = 3; i < words.length && out.length < limit; ) {
    seed = (seed * 1103515245 + 12345) % 2147483647;
    const span = 2 + (seed % 4);
    const first = words[i];
    const last = words[Math.min(i + span - 1, words.length - 1)];
    out.push({ start: first.index, end: last.index + last[0].length, seed });
    // Wide gaps on purpose: a handful of marks per section reads as attention
    // moving over the page, where one every other line reads as noise.
    i += span + 14 + (seed % 23);
  }
  return out;
}
