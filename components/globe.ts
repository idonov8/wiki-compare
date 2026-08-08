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

/* ---------------------------------------------------------------------------
   The same sphere as a rule, rather than as seven measured ellipses.

   `PARALLELS` is the rounded output of exactly what follows: a parallel at
   latitude φ is drawn at rx = R·cos φ, ry = 0.26·rx, cy = GLOBE_CY − R·sin φ,
   and its seven rows are φ = 0, ±25, ±50, ±72 put through it. Check any row.

   The landing page needs the rule and not just the output, because the cells it
   tints turn with the globe: their corners have to keep meeting these same
   ellipses at every angle, not only at the seven places the ellipses were
   measured. Everything here derives the wireframe rather than replacing it, so
   the drawn structure is untouched — the parallels are still the parallels.
   ------------------------------------------------------------------------ */

const RAD = Math.PI / 180;

/** The sphere's radius, and how far a parallel is flattened in y. */
export const GLOBE_R = 62;
const FLATTEN = 0.26;

/** The latitudes `PARALLELS` is measured at, north to south. Cells are cut
 *  from the six bands between them. */
export const LATITUDES = [72, 50, 25, 0, -25, -50, -72];

/**
 * Four meridian great circles, evenly spaced. 45° apart is as far as four can
 * get: the circle at λ and the one at λ+180° are the same circle, so the range
 * to divide is 180°, not 360°.
 */
export const MERIDIAN_LON = [0, 45, 90, 135];

/** Longitude wrapped into (−180, 180], so "behind the sphere" is a test on the
 *  magnitude rather than on which way round the count has gone. */
export function normaliseLon(deg: number): number {
  return ((((deg + 180) % 360) + 360) % 360) - 180;
}

/** A point on the sphere's surface, projected. */
function at(lat: number, lon: number): [number, number] {
  const p = lat * RAD;
  const l = lon * RAD;
  const rx = GLOBE_R * Math.cos(p);
  return [
    GLOBE_CX + rx * Math.sin(l),
    GLOBE_CY - GLOBE_R * Math.sin(p) + FLATTEN * rx * Math.cos(l),
  ];
}

/**
 * The same, with longitude clamped to the visible hemisphere rather than
 * discarded — which is what trims a cell as it goes round the back. At exactly
 * ±90° the point sits at (GLOBE_CX ± R·cos φ, GLOBE_CY − R·sin φ), which is R
 * from the centre for every φ: the globe's own outline. So the limb does the
 * cutting, a cell straddling it is clipped along the edge of the sphere, and
 * one fully behind collapses to no width at all.
 */
function front(lat: number, lon: number): [number, number] {
  return at(lat, Math.max(-90, Math.min(90, lon)));
}

/**
 * A meridian great circle, as a path.
 *
 * Drawn from the projection above rather than as an axis-aligned ellipse, which
 * is what `Loading` uses and what this file's `MERIDIAN_RX` is for. The ellipse
 * is the cheaper lie and it is fine on its own, but it is not the surface the
 * parallels describe: put a tinted cell between two of those ellipses and the
 * grid lines cut visibly through it, because the cell's corners are on the
 * parallels and the ellipse's are not. One projection for the whole wireframe
 * means a cell lands inside its own square at every angle.
 *
 * Both halves are drawn — the far side at lon + 180° — because a great circle
 * seen from outside is a closed curve, not an arc.
 */
export function meridianPath(lon: number): string {
  const STEPS = 24;
  const pts: [number, number][] = [];
  for (let i = 0; i <= STEPS; i++) pts.push(at(-90 + (180 * i) / STEPS, lon));
  for (let i = STEPS; i >= 0; i--) pts.push(at(-90 + (180 * i) / STEPS, lon + 180));
  return `M ${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ")} Z`;
}

/**
 * One cell of the grid — the patch between two parallels and two meridians — as
 * a path.
 *
 * Sampled rather than drawn with arc commands: the four edges are arcs of four
 * different ellipses, and the limb can cut across any of them at any angle, so
 * there is no fixed set of arcs to write down. Nine points along the top and
 * bottom is enough that the cut edge stays on the outline; three down each side
 * is enough for a band 22° tall.
 */
export function cellPath(
  latTop: number,
  latBottom: number,
  lonLeft: number,
  lonRight: number,
): string {
  const ALONG = 9;
  const DOWN = 3;
  const pts: [number, number][] = [];

  const lon = (i: number, n: number) => lonLeft + ((lonRight - lonLeft) * i) / n;
  const lat = (i: number, n: number) => latTop + ((latBottom - latTop) * i) / n;

  for (let i = 0; i < ALONG; i++) pts.push(front(latTop, lon(i, ALONG - 1)));
  for (let i = 1; i <= DOWN; i++) pts.push(front(lat(i, DOWN), lonRight));
  for (let i = ALONG - 2; i >= 0; i--) pts.push(front(latBottom, lon(i, ALONG - 1)));
  for (let i = DOWN - 1; i >= 1; i--) pts.push(front(lat(i, DOWN), lonLeft));

  return `M ${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ")} Z`;
}
