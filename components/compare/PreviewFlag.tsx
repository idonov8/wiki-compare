"use client";

/**
 * A part-read article says so here first.
 *
 * The one filled thing in the strip — everything else on that line is hairlines
 * and soft grey — because it is the fact that decides how the columns below
 * should be read.
 */
export default function PreviewFlag({ className = "" }: { className?: string }) {
  return (
    <span
      className={`preview-flag inline-flex items-center gap-[7px] border border-ink bg-ink px-[9px] py-[4px] font-mono text-[10px] leading-none tracking-[0.14em] uppercase text-paper-raised ${className}`}
    >
      <span
        className="h-[5px] w-[5px] rounded-full bg-paper-raised animate-attention-pulse"
        aria-hidden
      />
      Preview
    </span>
  );
}
