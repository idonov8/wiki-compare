"use client";

import { MEASURE } from "./Section";

/**
 * The colophon. Not an argument, just a signature — a year, a name, and a
 * quiet way to give a little back, in the same mono voice as the meta strip
 * above a cached article.
 */
export default function Footer({ onDonate }: { onDonate: () => void }) {
  return (
    <footer className="mt-[max(6vh,40px)] border-t border-rule px-[24px] py-[22px] max-tight:px-[18px]">
      <div
        className={`${MEASURE} flex items-baseline justify-between gap-[16px] font-mono text-[11px] tracking-[0.04em] text-ink-soft max-tight:flex-col max-tight:items-start`}
      >
        <span className="min-w-0 flex-1">
          © {new Date().getFullYear()} · Project by <a href="https://idonov.com" target="_blank" rel="noopener noreferrer" className="text-ink hover:underline">Ido Nov</a>
        </span>
        <button
          type="button"
          className="shrink-0 border border-rule px-[10px] py-[4px] font-mono text-[11px] tracking-[0.04em] text-ink-soft transition-colors duration-[120ms] hover:border-ink hover:text-ink"
          onClick={onDonate}
        >
          Donate
        </button>
      </div>
    </footer>
  );
}
