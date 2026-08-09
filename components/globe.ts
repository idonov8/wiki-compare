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
 * The outline, drawn as an arc that stops short of closing — `Loading`'s, and
 * only `Loading`'s. The gap at the upper right is where the last tile settles,
 * so it reads as a space being filled rather than as a hole. The landing page
 * has no tile coming and draws the circle closed: the same arc there was just
 * a bite missing out of the sphere.
 */
export const RING_PATH = "M 206.1 90.5 A 62 62 0 1 1 183.2 74.5";

/**
 * The meridians' resting widths. `Loading` animates `rx` to turn the sphere,
 * but the attribute still has to hold a staggered value: with motion turned off
 * these are all that is left, and four identical circles would not read as a
 * globe.
 */
export const MERIDIAN_RX = [62, 46, 30, 14];

/* ---------------------------------------------------------------------------
   The sphere as a rule, rather than as seven measured ellipses.

   A parallel at latitude φ is drawn at rx = R·cos φ, ry = 0.26·rx, and
   cy = GLOBE_CY − cos(tilt)·R·sin φ. `PARALLELS` is that rule run over
   φ = 72, 50, 25, 0, −25, −50, −72 rather than seven rows of numbers, because
   the landing page needs the rule anyway: the cells it tints turn with the
   globe, so their corners have to keep meeting these same ellipses at every
   angle and not only where the ellipses were measured. Deriving both from one
   place is what stops the drawn wireframe and the tinted surface from being
   two different spheres.
   ------------------------------------------------------------------------ */

const RAD = Math.PI / 180;

/** The sphere's radius, and how far a parallel is flattened in y. */
export const GLOBE_R = 62;
const FLATTEN = 0.26;

/**
 * The angle the globe is leant towards the viewer, and the two ratios the rest
 * of the file needs it as.
 *
 * Flattening a parallel to 0.26 of its width *is* a tilt — of asin(0.26), about
 * 15° — and every other term has to be told. A pole is `cos(tilt)·R` from the
 * centre of the picture, not `R`; drop the cosine and the polar rings sit too
 * far out, their far edges land beyond the limb, and the wireframe crawls
 * outside the outline it is supposed to be inside. Which is exactly what it
 * used to do: the ring came out buried in the mesh at the top and bottom of the
 * sphere, showing through as two stray black dashes.
 */
const TILT = Math.asin(FLATTEN);
const TILT_COS = Math.cos(TILT);
const TILT_TAN = Math.tan(TILT);

/** The latitudes the parallels are drawn at, north to south. Cells are cut
 *  from the six bands between them. */
export const LATITUDES = [72, 50, 25, 0, -25, -50, -72];

/** Latitude rings: cy/rx/ry, flattened by `FLATTEN` for perspective. */
export const PARALLELS: [cy: number, rx: number, ry: number][] = LATITUDES.map(
  (lat) => {
    const rx = GLOBE_R * Math.cos(lat * RAD);
    return [GLOBE_CY - TILT_COS * GLOBE_R * Math.sin(lat * RAD), rx, FLATTEN * rx];
  },
);

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
    GLOBE_CY - TILT_COS * GLOBE_R * Math.sin(p) + FLATTEN * rx * Math.cos(l),
  ];
}

/**
 * The last longitude at this latitude still facing the viewer.
 *
 * Not 90°. A tilted globe shows more than a hemisphere of the pole leaning
 * towards the camera and less of the other: at 72°N over two-thirds of the
 * parallel is in view, at 72°S barely a fifth. The terminator is where the
 * surface turns edge-on — cos φ·cos λ·cos(tilt) + sin φ·sin(tilt) = 0 — and a
 * point on it projects exactly onto the limb circle, which is what lets it be
 * used as a clip.
 */
function limbLon(lat: number): number {
  const c = -Math.tan(lat * RAD) * TILT_TAN;
  if (c <= -1) return 180;
  if (c >= 1) return 0;
  return Math.acos(c) / RAD;
}

/**
 * A point, with longitude clamped to the visible side rather than discarded —
 * which is what trims a cell as it goes round the back. Clamped at the
 * terminator, so the limb does the cutting: a cell straddling it is clipped
 * along the edge of the sphere, and one fully behind collapses to no width at
 * all.
 */
function front(lat: number, lon: number): [number, number] {
  const limb = limbLon(lat);
  return at(lat, Math.max(-limb, Math.min(limb, lon)));
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
 * bottom is enough that the cut edge stays on the outline. Six down each side,
 * rather than the three a 22° band needs on its own: a clipped side is not a
 * meridian but the terminator, which swings through 37° of longitude over the
 * top band alone, and three points across that much curve is a visible facet.
 */
export function cellPath(
  latTop: number,
  latBottom: number,
  lonLeft: number,
  lonRight: number,
): string {
  const ALONG = 9;
  const DOWN = 6;
  const pts: [number, number][] = [];

  const lon = (i: number, n: number) => lonLeft + ((lonRight - lonLeft) * i) / n;
  const lat = (i: number, n: number) => latTop + ((latBottom - latTop) * i) / n;

  for (let i = 0; i < ALONG; i++) pts.push(front(latTop, lon(i, ALONG - 1)));
  for (let i = 1; i <= DOWN; i++) pts.push(front(lat(i, DOWN), lonRight));
  for (let i = ALONG - 2; i >= 0; i--) pts.push(front(latBottom, lon(i, ALONG - 1)));
  for (let i = DOWN - 1; i >= 1; i--) pts.push(front(lat(i, DOWN), lonLeft));

  return `M ${pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ")} Z`;
}
