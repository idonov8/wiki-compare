/**
 * The site's name, plus the one glyph this brand gets to have: three bars in
 * the same three colours the diff rail and the legend use for contradiction,
 * omission and framing (`Legend`, `DiffNav`). One subject read three ways is
 * the entire product, so the mark says that before a reader has run a single
 * comparison, in the site's own colour vocabulary rather than a borrowed one.
 * At rest the bars sit close and tilted, like a folded ribbon; on hover or
 * keyboard focus they fan out level, the way the columns themselves fan out
 * into three tellings of one article.
 *
 * `beta` rides low on the baseline, the way a trademark mark sits off a
 * wordmark rather than floating centred beside it. Its own hover throws the
 * same three colours through it in one diagonal pass — the strand's palette,
 * reused rather than a generic shine, so the two live marks read as one idea.
 */
export default function Wordmark() {
  return (
    <a
      href="/"
      aria-label="Wiki Narratives — beta"
      className="wordmark group inline-flex items-end gap-[10px] no-underline"
    >
      <span className="wordmark-type font-wordmark text-[29px] leading-none tracking-[-0.01em] text-ink italic">
        wiki
        <Strand />
        narratives
      </span>
      <BetaBadge />
    </a>
  );
}

function BetaBadge() {
  return (
    <span
      className="beta-badge group/beta relative mb-[3px] inline-block overflow-hidden rounded-[2px] border border-rule bg-paper-raised px-[6px] py-[2px] font-mono text-[10px] leading-none tracking-[0.09em] text-ink-soft uppercase transition-transform duration-150 ease-out hover:-translate-y-[1px] hover:-rotate-[3deg] hover:border-ink hover:text-ink group-focus-visible:-translate-y-[1px] group-focus-visible:-rotate-[3deg] group-focus-visible:border-ink group-focus-visible:text-ink"
    >
      beta
      <i
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-[-2px] left-0 w-[60%] -translate-x-[170%] skew-x-[-18deg] bg-gradient-to-r from-framing via-contradiction to-unique opacity-0 transition-[transform,opacity] duration-500 ease-out group-hover/beta:translate-x-[230%] group-hover/beta:opacity-80 group-focus-visible:translate-x-[230%] group-focus-visible:opacity-80"
      />
    </span>
  );
}

/** Decorative only — the link's accessible name comes from the `aria-label` above. */
function Strand() {
  const bar =
    "absolute top-0 h-full w-[3px] rounded-[1px] transition-[left,transform] duration-200 ease-out";
  return (
    <span
      aria-hidden="true"
      className="strand relative mx-[5px] inline-block h-[18px] w-[15px] align-middle"
    >
      <i
        className={`${bar} left-[1px] rotate-[-10deg] bg-framing group-hover:left-[-3px] group-hover:rotate-0 group-focus-visible:left-[-3px] group-focus-visible:rotate-0`}
      />
      <i className={`${bar} left-[6px] bg-contradiction`} />
      <i
        className={`${bar} left-[11px] rotate-[10deg] bg-unique group-hover:left-[15px] group-hover:rotate-0 group-focus-visible:left-[15px] group-focus-visible:rotate-0`}
      />
    </span>
  );
}
