"use client";

import { useEffect, useState } from "react";
import ClaimRatio, { CLAIM_KINDS } from "@/components/ClaimRatio";
import Section from "./Section";
import { LANGS, LANG_META, type RecentArticle, type ScopeKind } from "@/lib/types";

interface Props {
  recent: RecentArticle[];
  onOpen: (title: string, lang: string) => void;
  /** "3 hours ago" — the formatter already used in the meta strip, passed in
   *  rather than duplicated. */
  relative: (iso: string) => string;
  /** True until the first `/api/recent` response lands. Renders a skeleton
   *  built from real rows with their text hidden, so it takes on exactly the
   *  height the ledger is about to have and nothing moves when the fetch
   *  resolves. */
  loading: boolean;
}

/** Rows to skeleton while the real list is in flight. The list itself is
 *  unbounded, so this is not a count of what is coming — it is enough rows to
 *  fill the scroll box, which is all the reader can see either way. */
const SKELETON_ROWS = Array.from({ length: 12 }, (_, i) => i);

/** The bar zone in a row, and the shortest an edition that exists may draw —
 *  same reasoning as the chart in the masthead, at half the height. */
const TALLEST = 18;
const SHORTEST = 2;

const wordsSaid = (words: RecentArticle["words"]): string =>
  LANGS.filter((lang) => words[lang])
    .map((lang) => `${LANG_META[lang].label} ${words[lang]!.toLocaleString()} words`)
    .join(", ");

const claimsSaid = (claims: RecentArticle["claims"], scope: ScopeKind): string =>
  scope === "preview"
    ? "differences not counted — cached run read the free preview"
    : CLAIM_KINDS.filter(({ kind }) => claims[kind])
        .map(({ kind, noun }) => `${claims[kind]} ${noun}`)
        .join(", ") || "no differences found";

/**
 * How much each edition has written, as three bars in a fixed en·he·ar order,
 * each over its own code — the same pairing of bar and language the masthead
 * chart makes, since a bar nobody can attribute to a language is a texture
 * rather than a reading. Fixed order, so the codes stay where a reader who has
 * looked at one row already expects to find them.
 *
 * Scaled against this subject's own longest edition rather than the ledger's:
 * the fact worth reading off a row is how lopsided its editions are, and a
 * ledger-wide scale would flatten every ordinary article into slivers behind
 * whichever one happens to be the longest thing cached.
 */
function WordBars({ words, delay }: { words: RecentArticle["words"]; delay: number }) {
  const longest = Math.max(1, ...LANGS.map((lang) => words[lang] ?? 0));
  return (
    <span className="recent-words flex flex-col" title={wordsSaid(words)} aria-hidden>
      <span className="recent-bars flex h-[18px] items-end gap-[4px] border-b border-rule pb-[3px]">
        {LANGS.map((lang, index) => {
          const count = words[lang] ?? 0;
          return (
            <span
              key={lang}
              className={`w-[12px] origin-bottom animate-bar-rise ${
                count ? "bg-ink-soft group-hover:bg-ink" : "bg-ink-wash-strong"
              }`}
              style={{
                height: count ? Math.max(SHORTEST, Math.round((count / longest) * TALLEST)) : 1,
                animationDelay: `${delay + index * 40}ms`,
              }}
            />
          );
        })}
      </span>
      {/* A code over an edition the subject does not have is printed in the same
          wash as its stub: the pair still says "asked for, not there", which is
          a different fact from a language the ledger never mentions. */}
      <span className="mt-[4px] flex gap-[4px] font-mono text-[9px] leading-none tracking-[0.06em] uppercase">
        {LANGS.map((lang) => (
          <span
            key={lang}
            className={`w-[12px] text-center ${words[lang] ? "text-ink-soft" : "text-ink-wash-strong"}`}
          >
            {lang}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * What kind of differences were found, as one line divided in proportion.
 *
 * Counts, not lengths: the line says a run was mostly contradictions or mostly
 * framing, which is the character of a disagreement rather than its size. The
 * empty track stays visible when nothing was found, because a row that drew
 * nothing there would read as a row that was never read.
 *
 * A preview draws the word instead of a line. Its counts are whatever the
 * opening section happened to contain rather than what the article says, so a
 * proportion drawn from them would read as the shape of the whole disagreement;
 * saying so in the line's own place is both the honest reading and the only
 * thing the row still needs to say about how much was read.
 */
function RatioLine({
  claims,
  scope,
  delay,
}: {
  claims: RecentArticle["claims"];
  scope: ScopeKind;
  delay: number;
}) {
  if (scope === "preview") {
    return (
      <span className="mt-[5px] border-b border-rule pb-[3px]">
        <span
          className="recent-ratio block w-[84px] text-center font-mono text-[10px] leading-[10px] tracking-[0.09em] uppercase text-ink-soft max-tight:w-[54px]"
          title="Cached run read the free preview — differences not counted"
        >
          Preview
        </span>
      </span>
    );
  }
  return (
    // Padded down to the height of the bar zone beside it so the two rules meet
    // into one axis across the mark, the same way the masthead's baselines run
    // unbroken under all three of its bars.
    <span className="mt-[9px] border-b border-rule pb-[3px]">
      <ClaimRatio
        counts={claims}
        className="h-[6px] w-[84px] max-tight:w-[54px]"
        delay={delay + 140}
        title={claimsSaid(claims, scope)}
      />
    </span>
  );
}

/**
 * Articles somebody has already paid to have read.
 *
 * Every cached subject is here, not a recent handful: this is the record of
 * what the site has read, and an article dropping off it because eleven newer
 * ones arrived would make the ledger quietly wrong. What that costs is height,
 * so the rows scroll within a box rather than pushing the footer down a page at
 * a time.
 *
 * Kept as a list rather than as cards on purpose: it is a ledger, not a
 * gallery.
 */
export default function RecentList({ recent, onOpen, relative, loading }: Props) {
  // A link into the ledger can ask for the full-only filter up front, e.g.
  // `/?full=true#recently-compared` from the preview gate. `window` isn't
  // there yet during server prerendering, so the initial state stays `false`
  // and this only runs once the component is mounted in the browser.
  const [fullOnly, setFullOnly] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("full") === "true") {
      setFullOnly(true);
    }
  }, []);

  if (!loading && !recent.length) return null;

  const shown = fullOnly ? recent.filter((item) => item.scope === "full") : recent;

  return (
    <Section
      heading="Recently compared:"
      className="py-[max(7vh,52px)]"
      id="recently-compared"
      action={
        !loading && (
          <div className="flex shrink-0 items-baseline gap-[12px]">
            {/* The box only ever shows ten or so rows, and it can land on a row
                boundary and read as the whole list. The count is what says
                otherwise, and while the filter is on it says what was hidden. */}
            <span className="font-mono text-[11px] tracking-[0.04em] text-ink-soft" aria-live="polite">
              {fullOnly ? `${shown.length} of ${recent.length}` : `${recent.length} articles`}
            </span>
            <button
              type="button"
              className="recent-filter border border-rule px-[10px] py-[5px] font-mono text-[11px] tracking-[0.09em] uppercase text-ink-soft hover:bg-paper-raised aria-pressed:border-ink aria-pressed:bg-ink aria-pressed:text-paper-raised"
              aria-pressed={fullOnly}
              onClick={() => setFullOnly((on) => !on)}
            >
              Full only
            </button>
          </div>
        )
      }
    >
      {/* The rules and the scrolling live on the same box, so both lines stay
          put while the rows travel between them — a row cut off at the bottom
          edge then reads as more of the ledger below, not as the end of it. */}
      <div className="mt-[26px] max-h-[min(62vh,520px)] overflow-y-auto overscroll-contain border-y border-rule">
        <ul className="recent m-0 list-none p-0" aria-busy={loading}>
          {loading
            ? SKELETON_ROWS.map((i) => (
                <li key={i} className="border-b border-rule last:border-b-0" aria-hidden="true">
                  <div className="flex w-full items-baseline gap-[14px] px-[8px] py-[11px]">
                    {/* Real text, made invisible rather than swapped for a bare
                        div: the glyphs still lay out and set the line's height,
                        so the bar behind them is exactly the row's real size. */}
                    <span
                      className="recent-title min-w-0 flex-1 animate-chip-breathe overflow-hidden text-ellipsis whitespace-nowrap rounded-[2px] bg-ink-wash-strong text-transparent"
                      style={{ animationDelay: `${i * -0.3}s` }}
                    >
                      Loading recent article title
                    </span>
                    <span className="flex shrink-0 items-start gap-[12px] self-center border-b border-rule pb-[3px] max-tight:gap-[8px]">
                      <span
                        className="h-[18px] w-[44px] animate-chip-breathe bg-ink-wash-strong"
                        style={{ animationDelay: `${i * -0.3}s` }}
                      />
                      <span
                        className="mt-[9px] h-[6px] w-[84px] animate-chip-breathe bg-ink-wash-strong max-tight:w-[54px]"
                        style={{ animationDelay: `${i * -0.3}s` }}
                      />
                    </span>
                  </div>
                </li>
              ))
            : shown.map((item, index) => (
                <li key={item.qid} className="border-b border-rule last:border-b-0">
                  <button
                    type="button"
                    className="group flex w-full items-baseline gap-[14px] border-0 bg-none px-[8px] py-[11px] text-start [font:inherit] text-wiki-link hover:bg-paper-raised"
                    onClick={() => onOpen(item.title, item.lang)}
                    aria-label={`Compare ${item.title}, ${item.scope} cached ${relative(
                      item.computedAt,
                    )}, ${wordsSaid(item.words)}, ${claimsSaid(item.claims, item.scope)}`}
                  >
                    <span
                      className="recent-title min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left group-hover:underline"
                      dir={LANG_META[item.lang].dir}
                      lang={item.lang}
                    >
                      {item.title}
                    </span>
                    {/* Both marks on one hairline axis, the same device the
                        masthead chart draws under its bars: the lengths stand
                        on it and the difference line runs along it, so the two
                        read as one reading of the row rather than as two
                        widgets that happen to be adjacent. */}
                    <span className="flex shrink-0 items-start gap-[12px] self-center max-tight:gap-[8px]">
                      {/* The ledger plots itself once, top down, as the fetch
                          lands. Capped a few rows in: past that the cascade is
                          a queue rather than a reading, and a row scrolled to
                          is better already drawn than drawing. */}
                      <WordBars words={item.words} delay={Math.min(index, 8) * 45} />
                      <RatioLine
                        claims={item.claims}
                        scope={item.scope}
                        delay={Math.min(index, 8) * 45}
                      />
                    </span>
                  </button>
                </li>
              ))}
        </ul>

        {!loading && !shown.length && (
          <p className="m-0 px-[8px] py-[16px] text-[14px] text-ink-soft">
            Nothing has been read in full yet.
          </p>
        )}
      </div>

      {/* What the two marks on every row mean, said once under the ledger rather
          than as column headings: the rows are the thing being read, and a
          header strip twelve rows above the marks it labels would be the louder
          half of the page. The bars name their own languages in the row, so all
          this has left to say is what is being counted. */}
      <div className="mt-[11px] flex flex-wrap items-center gap-x-[18px] gap-y-[6px] px-[8px] font-mono text-[10px] tracking-[0.09em] uppercase text-ink-soft">
        <span className="flex items-center gap-[6px]">
          <span className="flex h-[9px] items-end gap-[2px]" aria-hidden>
            <span className="h-[9px] w-[3px] bg-ink-soft" />
            <span className="h-[4px] w-[3px] bg-ink-soft" />
            <span className="h-[2px] w-[3px] bg-ink-soft" />
          </span>
          words per version
        </span>
        {CLAIM_KINDS.map(({ kind, fill, noun }) => (
          <span key={kind} className="flex items-center gap-[6px]">
            <span className={`h-[5px] w-[14px] ${fill}`} aria-hidden />
            {noun}
          </span>
        ))}
      </div>
    </Section>
  );
}
