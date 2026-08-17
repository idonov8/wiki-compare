"use client";

import { MEASURE } from "./landing/Section";

/** Where a correction request lands. The same address as the privacy notice's,
 *  deliberately: one inbox that is actually read beats two that are not. */
const CONTACT = "contact@wikicompare.app";

/**
 * The colophon, at the foot of every page: the standing caveat, a route to
 * complain, the licence the columns are under, and a signature.
 *
 * Everything here has to be on every page to do its job — the caveat is true of
 * every comparison, the mailto is the complaint route a defamation claim asks
 * for, and CC BY-SA wants naming wherever the material is. What can be read
 * once rather than on every page — how the excerpting works, what happens after
 * a complaint arrives — lives in /privacy instead, so this stays two lines.
 */
export default function Footer({
  onDonate,
  className = "",
}: {
  onDonate: () => void;
  className?: string;
}) {
  return (
    <footer
      className={`mt-[max(6vh,40px)] border-t border-rule px-[24px] py-[18px] max-tight:px-[18px] ${className}`}
    >
      <div
        className={`${MEASURE} grid gap-[10px] font-mono text-[11px] leading-[1.65] tracking-[0.04em] text-ink-soft`}
      >
        <p className="m-0">
          Comparisons are machine-generated and can be wrong. Treat marked differences as pointers to
          check the sources, not as findings.{" "}
          <a
            href={`mailto:${CONTACT}?subject=${encodeURIComponent("Wiki Compare: correction")}`}
            className="text-ink hover:underline"
          >
            Report a problem
          </a>
        </p>
        <div className="flex items-baseline justify-between gap-[16px] max-tight:flex-col max-tight:items-start">
          <span className="min-w-0 flex-1">
            © {new Date().getFullYear()}{" "}
            <a
              href="https://idonov.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-ink hover:underline"
            >
              Ido Nov
            </a>{" "}
            · Wikipedia text &amp; photos, excerpted under{" "}
            <a
              href="https://creativecommons.org/licenses/by-sa/4.0/"
              target="_blank"
              rel="license noopener noreferrer"
              className="text-ink hover:underline"
            >
              CC BY-SA 4.0
            </a>{" "}
            ·{" "}
            <a href="/privacy" className="text-ink hover:underline">
              Privacy
            </a>
          </span>
          <button
            type="button"
            className="shrink-0 border border-rule px-[10px] py-[4px] font-mono text-[11px] tracking-[0.04em] text-ink-soft transition-colors duration-[120ms] hover:border-ink hover:text-ink"
            onClick={onDonate}
          >
            Donate
          </button>
        </div>
      </div>
    </footer>
  );
}
