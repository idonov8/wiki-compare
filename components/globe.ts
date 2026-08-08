/**
 * The sphere's geometry, hand-placed against a 320x300 viewBox.
 *
 * Shared because the globe is drawn twice: once in `Loading`, where it turns
 * while a comparison runs, and once on the landing page, where it sits still as
 * a piece of the page's furniture. Copying the numbers into the second one is
 * how the two slowly stop being the same object.
 */

/** Centre of the sphere, and its radius. */
export const GLOBE_CX = 160;
export const GLOBE_CY = 132;

/**
 * The outline, drawn as an arc that stops short of closing. The gap at the
 * upper right is deliberate: `Loading` settles a tile into it, and even at rest
 * an unclosed ring reads as drawn by a hand rather than by a shape tool.
 */
export const RING_PATH = "M 206.1 90.5 A 62 62 0 1 1 183.2 74.5";

/** Latitude rings: cy/rx/ry, flattened by 0.26 for perspective. */
export const PARALLELS: [cy: number, rx: number, ry: number][] = [
  [132, 62, 16],
  [105.8, 56.2, 14.6],
  [158.2, 56.2, 14.6],
  [84.5, 39.9, 10.4],
  [179.5, 39.9, 10.4],
  [73, 19.2, 5],
  [191, 19.2, 5],
];

/**
 * The meridians' resting widths. `Loading` animates `rx` to turn the sphere,
 * but the attribute still has to hold a staggered value: with motion turned off
 * these are all that is left, and four identical circles would not read as a
 * globe.
 */
export const MERIDIAN_RX = [62, 46, 30, 14];
