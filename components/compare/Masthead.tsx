"use client";

import SearchBox from "../SearchBox";
import Wordmark from "../Wordmark";
import { track } from "@/lib/analytics";
import { SOURCE_URL } from "@/lib/contact";

/**
 * Sticky on the landing page only. That page scrolls far enough that a masthead
 * pinned to the top of the document would be gone by the second section, taking
 * the search with it — but a comparison must not have one.
 * Everything that scrolls a mark into view there (DiffNav, the internal links, a
 * jump from the URL) lands it at the top of the viewport, and a sticky header
 * sits on exactly that spot: the mark arrives already covered, and the hover
 * card it is supposed to open never opens. `npm run check:ui` catches this.
 */
export default function Masthead({
  sticky,
  /** On the landing page the search appears only once the hero's own field has
   *  scrolled away — two boxes visible at once is the same control asked for
   *  twice. Everywhere else it is the only search there is. */
  showSearch,
  query,
  onQueryChange,
  onSearch,
  busy,
  onFeedback,
}: {
  sticky: boolean;
  showSearch: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  busy: boolean;
  onFeedback: () => void;
}) {
  return (
    <header
      className={`masthead z-40 overflow-x-clip border-b border-rule bg-paper px-[24px] py-[20px] flex gap-[24px] items-center flex-wrap max-cols:px-[18px] max-cols:py-[14px] max-cols:gap-[14px] ${
        sticky ? "sticky top-0" : ""
      }`}
    >
      <Wordmark />
      {showSearch && (
        <SearchBox
          variant="bar"
          // Last and full width once the three columns no longer fit side by
          // side, so the masthead is the wordmark and the feedback link on one
          // line with the field under them, rather than the field taking a line
          // and leaving the link alone on a third.
          className="animate-reveal-in flex-[1_1_320px] max-cols:order-last max-cols:basis-full"
          value={query}
          onChange={onQueryChange}
          onSubmit={onSearch}
          busy={busy}
        />
      )}
      <div className="ms-auto flex shrink-0 items-center gap-[8px] max-cols:gap-[5px]">
        <button
          type="button"
          className="font-mono text-[12px] tracking-[0.04em] text-ink-soft hover:border-ink hover:text-ink"
          onClick={onFeedback}
        >
          <span className="max-[410px]:hidden">send </span>feedback
        </button>
        <a
          href={SOURCE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Source on GitHub"
          className="flex text-ink-soft transition-colors duration-[120ms] hover:text-ink"
          onClick={() => track("source_clicked", { surface: "masthead" })}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
        </a>
      </div>
    </header>
  );
}
