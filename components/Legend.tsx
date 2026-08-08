/**
 * The three kinds of difference, and the band each one wears.
 *
 * Shown twice: in the controls strip above a comparison, where it is a key to
 * marks already on screen, and on the landing page, where it is a promise about
 * marks the reader has not seen yet. Same swatches either way — the landing
 * page teaching one vocabulary and the article using another would be worse
 * than not teaching it at all.
 */

const KINDS = [
  ["contradiction", "bg-mark-contradiction inset-shadow-contradiction", "contradiction", "The versions state facts that cannot both be true."],
  ["unique", "bg-mark-unique inset-shadow-unique", "only in one version", "Material one language covers and the others skip entirely."],
  ["framing", "bg-mark-framing inset-shadow-framing", "different framing", "The same fact, told in words that carry a different claim."],
] as const;

export default function Legend({ describe = false }: { describe?: boolean }) {
  if (describe) {
    return (
      <dl className="legend-full grid grid-cols-3 gap-[22px] m-0 max-cols:grid-cols-1 max-cols:gap-[16px]">
        {KINDS.map(([key, swatch, label, note]) => (
          <div key={key} className="min-w-0">
            <dt className="flex items-center gap-[8px] font-mono text-[12px] tracking-[0.04em] text-ink">
              <i className={`inline-block w-[15px] h-[15px] rounded-[2px] shrink-0 ${swatch}`} />
              {label}
            </dt>
            <dd className="m-0 mt-[6px] text-[14px] leading-[1.6] text-ink-soft">{note}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    // A column beside the length chart on a phone, rather than a row under it.
    // Set as a row there the three kinds wrap onto two ragged lines and push
    // the strip down a third one, all while the space to the chart's right sits
    // empty — which is exactly where a key to the chart wants to be anyway.
    //
    // `basis-0` rather than letting the strip wrap it there: a legend that
    // drops below the chart the moment it stops fitting costs a line of height
    // on the narrowest screens, which are the ones that can least afford one.
    // Sized from zero it never pushes itself onto a line of its own, and
    // `min-w-fit` then claims back exactly the width its longest label needs —
    // so the leftover goes to the chart, which is the half of the strip that
    // can actually use it, and neither of them wraps down to 320px.
    <div className="legend flex flex-wrap gap-[16px] max-cols:gap-x-[12px] max-cols:gap-y-[6px] text-ink-soft max-tight:min-w-fit max-tight:flex-1 max-tight:basis-0 max-tight:flex-col max-tight:flex-nowrap max-tight:gap-y-[8px]">
      {KINDS.map(([key, swatch, label]) => (
        <span key={key} className="flex items-center gap-[6px]">
          <i className={`swatch ${key} inline-block w-[15px] h-[15px] rounded-[2px] ${swatch}`} /> {label}
        </span>
      ))}
    </div>
  );
}
