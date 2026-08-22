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
 * `beta` is a static stamp over the lower-right corner of the wordmark. It
 * shrinks once the three columns no longer fit, so the masthead stays compact
 * through the mid-width band as well as on phones.
 */
export default function Wordmark() {
  return (
    <span className="wordmark-group relative inline-flex">
      <a href="/" aria-label="Wiki Compare" className="wordmark group inline-flex items-end no-underline">
        <span className="wordmark-type font-wordmark text-[29px] max-cols:text-[26px] leading-none tracking-[-0.01em] text-ink italic">
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
    <span className="beta-badge pointer-events-none absolute z-10 -right-2.5 -bottom-4.75 inline-block rounded-xs border border-rule bg-paper-raised px-[6px] py-[2px] font-mono text-[10px] leading-none tracking-[0.09em] text-ink-soft uppercase max-cols:-right-1.5 max-cols:-bottom-3 max-cols:px-1 max-cols:py-px max-cols:text-[8px]">
      beta
    </span>
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
