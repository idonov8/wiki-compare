import Legend from "../Legend";
import Section from "./Section";

/**
 * Why the versions drift, and what the three marks are for.
 *
 * Placed after the example rather than before it. The reader who has just seen
 * three encyclopaedias name the same territory three ways will read this; the
 * reader who meets it cold reads a mission statement and scrolls.
 */
export default function WhyItMatters() {
  return (
    <Section numeral="III." kicker="Why it happens" heading="Nobody reads all three." className="py-[max(7vh,52px)]">
      <div className="mt-[18px] max-w-[58ch] text-[16px] leading-[1.75]">
        {/* A drop cap, because the passage is the one piece of sustained prose
            on the page and should look like it. */}
        <p className="m-0 first-letter:float-start first-letter:me-[10px] first-letter:mt-[6px] first-letter:font-display first-letter:text-[58px] first-letter:leading-[0.72] first-letter:text-ink">
          Each Wikipedia is written by a different community, in a different language,
          under different pressures, citing different sources. They are not translations
          of one another and were never meant to be. Over years the articles drift —
          quietly, in the numbers, in which paragraph comes first, in what a place is
          called.
        </p>
        <p className="mt-[18px] mb-0 text-ink-soft">
          The drift is visible only to someone reading all three at once, which almost
          nobody does. This site does it for you: it fetches the current revision of an
          article in English, Hebrew and Arabic, reads them against each other, and marks
          every place they part company.
        </p>
      </div>

      <div className="mt-[34px] border-t border-rule pt-[24px]">
        <Legend describe />
      </div>
    </Section>
  );
}
