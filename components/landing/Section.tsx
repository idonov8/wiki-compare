/**
 * One band of the landing page: the shared measure and padding.
 *
 * Because every section takes its measure from here, changing the page's
 * width or rhythm is one edit rather than several.
 */

interface Props {
  /** Section heading, set in the display face. */
  heading?: string;
  className?: string;
  children: React.ReactNode;
}

/** The measure every band shares. */
export const MEASURE = "mx-auto max-w-[860px]";

export default function Section({ heading, className = "", children }: Props) {
  return (
    <section className={`px-[24px] max-tight:px-[18px] ${className}`}>
      <div className={MEASURE}>
        {heading && (
          <h2 className="mt-0 mb-0 font-display font-normal text-[clamp(28px,4vw,40px)] leading-[1.05] tracking-[-0.01em] text-ink">
            {heading}
          </h2>
        )}
        {children}
      </div>
    </section>
  );
}
