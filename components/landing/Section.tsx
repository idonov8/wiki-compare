/**
 * One band of the landing page: the shared measure, padding, and the numeral in
 * the left margin.
 *
 * The numerals are the whole reason this exists. Nothing in them is
 * load-bearing — they are a manuscript's foliation — but they are what tells a
 * reader arriving at a full-height hero that there is a document below it, and
 * they hold the sections to one left edge that the eye can run down. Because
 * every section takes its measure from here, changing the page's width or
 * rhythm is one edit rather than five.
 */

interface Props {
  /** Roman numeral for the margin. Omitted on bands that are not part of the
   *  argument, like the footer. */
  numeral?: string;
  /** Section heading, set in the display face. */
  heading?: string;
  /** Mono kicker above the heading. */
  kicker?: string;
  id?: string;
  className?: string;
  children: React.ReactNode;
}

/** The measure every band shares, and the rail that hangs off its left edge. */
export const MEASURE = "mx-auto flex max-w-[860px] gap-[36px]";

export default function Section({ numeral, heading, kicker, id, className = "", children }: Props) {
  return (
    <section id={id} className={`px-[24px] max-tight:px-[18px] ${className}`}>
      <div className={MEASURE}>
        {/* Sticky, so the numeral stays beside whatever part of a long section
            is on screen rather than scrolling off with its first line. */}
        <div
          className="sticky top-[86px] hidden h-0 w-[34px] shrink-0 select-none pt-[8px] font-mono text-[11px] tracking-[0.12em] text-ink-soft opacity-60 cols:block"
          aria-hidden="true"
        >
          {numeral}
        </div>

        <div className="min-w-0 flex-1">
          {kicker && (
            <p className="m-0 font-mono text-[11px] tracking-[0.18em] uppercase text-ink-soft">{kicker}</p>
          )}
          {heading && (
            <h2 className="mt-[10px] mb-0 font-display font-normal text-[clamp(28px,4vw,40px)] leading-[1.05] tracking-[-0.01em] text-ink">
              {heading}
            </h2>
          )}
          {children}
        </div>
      </div>
    </section>
  );
}
