"use client";

import CreditBar from "../CreditBar";
import SearchBox from "../SearchBox";
import Wordmark from "../Wordmark";
import type { MeResponse } from "@/lib/types";

/**
 * Sticky on the landing page only. That page scrolls far enough that a masthead
 * pinned to the top of the document would be gone by the second section, taking
 * the search and the credit meter with it — but a comparison must not have one.
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
  me,
  onDonate,
  onLogIn,
}: {
  sticky: boolean;
  showSearch: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  busy: boolean;
  me: MeResponse | null;
  onDonate: () => void;
  onLogIn: () => void;
}) {
  return (
    <header
      className={`masthead z-40 overflow-x-clip border-b border-rule bg-paper px-[24px] py-[20px] flex gap-[24px] items-center flex-wrap max-tight:px-[18px] max-tight:py-[14px] max-tight:gap-[14px] ${
        sticky ? "sticky top-0" : ""
      }`}
    >
      <Wordmark />
      {showSearch && (
        <SearchBox
          variant="bar"
          // Last and full width on a phone, so the masthead is the wordmark and
          // the credit meter on one line with the field under them, rather than
          // the field taking a line and leaving the meter alone on a third.
          className="animate-reveal-in flex-[1_1_320px] max-tight:order-last max-tight:basis-full"
          value={query}
          onChange={onQueryChange}
          onSubmit={onSearch}
          busy={busy}
        />
      )}
      <div className="ms-auto">
        <CreditBar me={me} onDonate={onDonate} onLogIn={onLogIn} />
      </div>
    </header>
  );
}
