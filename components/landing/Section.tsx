/**
 * One band of the landing page: the shared measure and padding.
 *
 * Because every section takes its measure from here, changing the page's
 * width or rhythm is one edit rather than several.
 */

interface Props {
  /** Section heading, set in the display face. */
  heading?: string;
  /** A control that belongs to the heading rather than to the body — it sits on
   *  the heading's baseline, at the end of the measure. */
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

/** The measure every band shares. */
export const MEASURE = "mx-auto max-w-[860px]";

export default function Section({ heading, action, className = "", children }: Props) {
  return (
    <section className={`px-[24px] max-tight:px-[18px] ${className}`}>
      <div className={MEASURE}>
        {(heading || action) && (
          <div className="flex flex-wrap items-baseline justify-between gap-x-[18px] gap-y-[10px]">
            {heading && (
              <h2 className="mt-0 mb-0 font-display font-normal text-[clamp(28px,4vw,40px)] leading-[1.05] tracking-[-0.01em] text-ink">
                {heading}
              </h2>
            )}
            {action}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}
