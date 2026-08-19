import { BETA_GROUP_URL } from "@/lib/contact";

/**
 * The site's name, plus the one glyph this brand gets to have: three bars in
 * the same three colours the diff rail and the legend use for contradiction,
 * omission and framing (`Legend`, `DiffNav`). One subject read three ways is
 * the entire product, so the mark says that before a reader has run a single
 * comparison, in the site's own colour vocabulary rather than a borrowed one.
 * At rest the bars sit close and tilted, like a folded ribbon; on hover or
 * keyboard focus they drop onto a baseline and step down in height — the same
 * shape `LangBars` draws under the search field once a comparison is running,
 * where three editions of one article turn out to be nothing like the same
 * length. The mark makes the site's argument twice: three colours for three
 * readings, and a lopsided chart for how unevenly they are written.
 *
 * `beta` rides low on the baseline, the way a trademark mark sits off a
 * wordmark rather than floating centred beside it, and is its own link —
 * `<a>` cannot nest inside `<a>` — to the WhatsApp group for people testing
 * the redesign. Its own hover throws the same three colours through it in
 * one diagonal pass: the strand's palette, reused rather than a generic
 * shine, so the two live marks read as one idea even though only one of
 * them leaves the site.
 */
export default function Wordmark() {
  return (
    <span className="wordmark-group inline-flex items-end gap-2.5">
      <a href="/" aria-label="Wiki Compare" className="wordmark group inline-flex items-end no-underline">
        <span className="wordmark-type font-wordmark text-[29px] max-tight:text-[26px] leading-none tracking-[-0.01em] text-ink italic">
          wiki
          <Strand />
          compare
        </span>
      </a>
      <BetaBadge />
    </span>
  );
}

function BetaBadge() {
  return (
    <a
      href={BETA_GROUP_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Join the Wiki Compare beta testers group on WhatsApp"
      className="beta-badge group/beta relative mb-[3px] inline-block overflow-hidden rounded-xs border border-rule bg-paper-raised px-[6px] py-[2px] font-mono text-[10px] leading-none tracking-[0.09em] text-ink-soft uppercase no-underline transition-transform duration-150 ease-out hover:-translate-y-[1px] hover:-rotate-[3deg] hover:border-ink hover:text-ink focus-visible:-translate-y-[1px] focus-visible:-rotate-[3deg] focus-visible:border-ink focus-visible:text-ink"
    >
      beta
      <i
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-[-2px] left-0 w-[60%] -translate-x-[170%] skew-x-[-18deg] bg-gradient-to-r from-framing via-contradiction to-unique opacity-0 transition-[transform,opacity] duration-500 ease-out group-hover/beta:translate-x-[230%] group-hover/beta:opacity-80 group-focus-visible/beta:translate-x-[230%] group-focus-visible/beta:opacity-80"
      />
    </a>
  );
}

/** Decorative only — the link's accessible name comes from the `aria-label` above. */
function Strand() {
  // Anchored at the bottom rather than the top, because a bar that shortens
  // from a shared baseline is a chart and one that shortens from a shared
  // ceiling is not. Widening as they land too: 4px on a 7px pitch keeps the
  // trio reading as one grouped mark rather than three separate strokes.
  const bar =
    "absolute bottom-0 h-[18px] w-[3px] rounded-[1px] transition-[left,width,height,transform] duration-200 ease-out group-hover:w-[4px] group-focus-visible:w-[4px]";
  return (
    <span
      aria-hidden="true"
      className="strand relative mx-[5px] inline-block h-[18px] w-[15px] align-middle"
    >
      {/* The 30/70/110ms stagger is the three bars landing in the order the
          chart sorts them; their shared bottom edge is the only axis needed. */}
      <i
        className={`${bar} left-[1px] rotate-[-10deg] bg-framing delay-[30ms] group-hover:left-[-1px] group-hover:rotate-0 group-focus-visible:left-[-1px] group-focus-visible:rotate-0`}
      />
      <i
        className={`${bar} left-[6px] bg-contradiction delay-[70ms] group-hover:h-[10px] group-focus-visible:h-[10px]`}
      />
      <i
        className={`${bar} left-[11px] rotate-[10deg] bg-unique delay-[110ms] group-hover:left-[13px] group-hover:h-[7px] group-hover:rotate-0 group-focus-visible:left-[13px] group-focus-visible:h-[7px] group-focus-visible:rotate-0`}
      />
    </span>
  );
}
