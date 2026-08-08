/**
 * The site's name, plus the one glyph this brand gets to have: three bars in
 * the same three colours the diff rail and the legend use for contradiction,
 * omission and framing (`Legend`, `DiffNav`). One subject read three ways is
 * the entire product, so the mark says that before a reader has run a single
 * comparison, in the site's own colour vocabulary rather than a borrowed one.
 * At rest the bars sit close and tilted, like a folded ribbon; on hover or
 * keyboard focus they fan out level, the way the columns themselves fan out
 * into three tellings of one article. `beta` stays a plain tag beside it —
 * the strand is the one thing here allowed to be loud.
 */
export default function Wordmark() {
  return (
    <a
      href="/"
      aria-label="Wiki Narratives — beta"
      className="wordmark group inline-flex items-center gap-[11px] no-underline"
    >
      <span className="wordmark-type font-wordmark text-[29px] leading-none tracking-[-0.01em] text-ink italic">
        wiki
        <Strand />
        narratives
      </span>
      <span className="beta-badge self-center rounded-[2px] border border-rule bg-paper-raised px-[6px] py-[2px] font-mono text-[10px] leading-none tracking-[0.09em] text-ink-soft uppercase">
        beta
      </span>
    </a>
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
