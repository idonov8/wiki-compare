"use client";

import { MEASURE } from "./Section";
import { PRICE_PER_ARTICLE_CENTS } from "@/lib/pricing";
import { CACHE_WINDOW_DAYS } from "@/lib/types";

/** The width the numerals occupy in every section above, held open here so the
 *  footer's text starts on the same vertical line. */
const RailGap = () => <div aria-hidden="true" className="hidden w-[34px] shrink-0 cols:block" />;

/**
 * The ask, and the reason it is not a subscription.
 *
 * The site's whole economy is in two sentences: a comparison costs real model
 * time to run once, and is free for everyone who arrives afterwards. That
 * exchange is the same one `costNote` makes in the meta strip above a cached
 * article — it belongs at the bottom of the landing page too, where somebody
 * who has just scrolled past a list of things other people paid for is best
 * placed to hear it.
 */
export default function SupportFooter({ onDonate }: { onDonate: () => void }) {
  return (
    <footer className="mt-[max(6vh,40px)] border-t border-rule bg-paper-raised px-[24px] py-[44px] max-tight:px-[18px]">
      {/* `RAIL` keeps the footer's left edge on the same line as every numbered
          section above it — the numerals stop here, but the margin they hang in
          does not. */}
      <div className={`${MEASURE} items-end max-cols:flex-col max-cols:items-start max-cols:gap-[24px]`}>
        <RailGap />
        <div className="min-w-0 flex-1 max-w-[52ch]">
          <p className="m-0 font-mono text-[11px] tracking-[0.18em] uppercase text-ink-soft">
            Support
          </p>
          <p className="mt-[12px] mb-0 font-display text-[clamp(24px,3.2vw,32px)] leading-[1.15] tracking-[-0.01em]">
            Reading three articles costs about {PRICE_PER_ARTICLE_CENTS} cents of model time.
          </p>
          <p className="mt-[14px] mb-0 text-[15px] leading-[1.65] text-ink-soft">
            Whoever runs an article first pays for it. Everyone who opens it afterwards
            reads it for nothing, until Wikipedia moves on far enough that it is worth
            reading again — about {CACHE_WINDOW_DAYS} days. That is the whole model, and
            it only works if some of the people reading are some of the people paying.
          </p>
        </div>

        <button
          type="button"
          className="shrink-0 border border-ink bg-ink px-[22px] py-[11px] font-mono text-[12px] tracking-[0.06em] text-paper-raised shadow-offset transition-colors duration-[120ms] hover:bg-transparent hover:text-ink"
          onClick={onDonate}
        >
          Donate
        </button>
      </div>

      <div className={`${MEASURE} mt-[40px]`}>
        <RailGap />
        <div className="flex flex-1 items-baseline justify-between gap-[16px] border-t border-rule pt-[18px] font-mono text-[11px] tracking-[0.04em] text-ink-soft max-tight:flex-col max-tight:gap-[8px]">
          <span className="font-display text-[18px] tracking-normal">
            wiki<span className="text-ink-soft">-</span>compare*
          </span>
          <span>Article text from Wikipedia, CC BY-SA.</span>
        </div>
      </div>
    </footer>
  );
}
