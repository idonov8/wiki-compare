"use client";

/**
 * A part-read article says so here first.
 *
 * Set like a headline, not a warning label: the donate button beside it is
 * still the one thing meant to be pressed, so this reads on its own terms
 * instead of shouting for the same attention — a word in the wiki's own sans,
 * on the same raised paper every panel on the site sits on, ringed in the
 * three inks the ledger and the mark bands use everywhere else for the three
 * kinds of difference. It names what "preview" is short of without spelling
 * it out.
 */
export default function PreviewFlag({ className = "" }: { className?: string }) {
  return (
    <span
      className={`preview-flag inline-flex items-center rounded-[8px] px-[16px] py-[6px] max-tight:rounded-[6px] max-tight:px-[10px] max-tight:py-[3px] font-wiki text-[26px] max-tight:text-[17px] font-normal leading-none text-ink-soft ${className}`}
    >
      Preview
    </span>
  );
}
