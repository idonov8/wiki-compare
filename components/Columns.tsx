"use client";

import Highlighted from "./Highlighted";
import {
  KEY_FACTS_HEADING,
  LANG_META,
  LEAD_HEADING,
  type ArticleSnapshot,
  type Claim,
  type Lang,
  type LinkSpan,
} from "@/lib/types";

/**
 * The articles, side by side. Rendered as soon as the text exists — before any
 * comparison — so the reader confirms they picked the right subject by reading
 * it, and so the wait is spent on the article rather than on a spinner.
 *
 * `ghost` marks drift over arbitrary phrases while the comparison runs: they
 * say the text is being read, and are visibly not findings — no hover, no
 * card, no tick on the rail.
 */
export default function Columns({
  articles,
  visible,
  claims,
  ghost = false,
  activeId = null,
  processedThrough,
  part = "whole",
  onEnter,
  onLeave,
  onLink,
}: {
  articles: Record<string, ArticleSnapshot>;
  visible: Lang[];
  claims: Claim[];
  ghost?: boolean;
  activeId?: string | null;
  /**
   * Per language, the body-section index this comparison read up to, exclusive.
   * Absent means the whole article was read and there is nothing to split.
   *
   * It is per language rather than one number because the aligned sections sit
   * at different positions in each edition — the English article can reach the
   * same subject two sections earlier than the Arabic one — so a single cut
   * would fall in the wrong place in two columns out of three.
   */
  processedThrough?: Partial<Record<Lang, number>>;
  /**
   * `whole` is the ordinary render. A funded comparison never needs anything
   * else. A preview renders twice — `head`, then the gate, then `tail` — so the
   * boundary can be a rule straight across all three columns rather than three
   * ragged fades at three different heights. `tail` drops the column heading,
   * title, image and key facts, because those belong to the top of the article
   * and printing them twice would read as the page having started over.
   */
  part?: "whole" | "head" | "tail";
  onEnter?: (claim: Claim, event: React.MouseEvent | React.FocusEvent) => void;
  onLeave?: () => void;
  onLink?: (title: string, lang: Lang) => void;
}) {
  return (
    <div
      className={
        part === "tail"
          ? // The unread remainder. It fades out rather than being cut off, because
            // the article does not end there — only our reading of it does.
            // No `user-select: none`: the text below the gate is Wikipedia's own,
            // free to anyone, and locking it would be charging for something we
            // neither wrote nor paid for. Only the comparison is unfunded.
            // `pointer-events` is off because there is nothing here to hover — no
            // marks were placed in this half — and a help cursor over plain text
            // would promise a card that never opens.
            // Both spellings of the mask: Safari still wants the prefix, and
            // dropping it would cut the remainder off flat rather than fading it.
            "columns columns-faded grid max-cols:block items-stretch bg-wiki-page [-webkit-mask-image:linear-gradient(to_bottom,black_0,transparent_340px)] [mask-image:linear-gradient(to_bottom,black_0,transparent_340px)] pointer-events-none"
          : "columns grid max-cols:block items-stretch bg-wiki-page"
      }
      aria-hidden={part === "tail" ? true : undefined}
      style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}
    >
      {visible.map((lang) => {
        const article = articles[lang];
        if (!article) return null;
        const meta = LANG_META[lang];
        const keyFacts = article.sections.find((s) => s.heading === KEY_FACTS_HEADING);
        const allBody = article.sections.filter((s) => s.heading !== KEY_FACTS_HEADING);
        const cut = processedThrough?.[lang] ?? allBody.length;
        const body =
          part === "head" ? allBody.slice(0, cut) : part === "tail" ? allBody.slice(cut) : allBody;
        const chrome = part !== "tail";
        const highlight = (text: string, links?: LinkSpan[]) => (
          <Highlighted
            text={text}
            lang={lang}
            claims={claims}
            links={links}
            ghost={ghost}
            activeId={activeId}
            onEnter={onEnter}
            onLeave={onLeave}
            onLink={onLink}
          />
        );
        return (
          // Physical, not inline: columns always sit en|he|ar left-to-right
          // regardless of each column's own direction, so the seam belongs
          // between every pair.
          <section
            key={lang}
            // The deeper bottom padding below `cols` is for the floating
            // language switch: it sits over this corner, and the article's last
            // paragraph must not end up underneath it.
            className="column min-w-0 pt-[22px] px-[26px] pb-20 max-cols:pb-[110px] max-tight:px-[17px] border-rule border-l first:border-l-0 max-cols:border-l-0 max-cols:border-t max-cols:first:border-t-0"
            dir={meta.dir}
            lang={lang}
          >
            {chrome && (
              <div className="column-head flex items-baseline gap-2.5 pb-2.5 mb-4 border-b-2 border-ink font-mono text-[12px] text-ink-soft">
                <span className="native font-body text-[17px] text-ink">{meta.native}</span>
                <span className="arrow text-[13px] text-ink" aria-hidden="true">
                  {meta.dir === "rtl" ? "←" : "→"}
                </span>
                <a
                  href={article.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-wiki-link no-underline hover:underline"
                >
                  rev {article.revid}
                </a>
              </div>
            )}
            {chrome && (
              <h1 className="article-title m-0 mb-3.5 pb-2 text-[26px] leading-tight font-wiki-heading font-normal border-b border-wiki-border text-wiki-text">
                {article.title}
              </h1>
            )}
            {chrome && article.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="article-image block mx-auto w-auto h-auto max-w-full max-h-[260px] object-contain m-0 mb-4 p-1 bg-wiki-page border border-wiki-border rounded-[2px]"
                src={article.image.src}
                alt={article.image.alt ?? article.title}
                loading="lazy"
              />
            )}
            {chrome && keyFacts && (
              <details className="key-facts group mb-5 border border-wiki-border rounded-[2px] bg-wiki-shade">
                <summary className="cursor-pointer py-2 px-3 font-mono text-[11px] tracking-[0.09em] uppercase text-ink-soft select-none group-open:border-b group-open:border-wiki-border">
                  Key facts
                </summary>
                <dl className="kf-body m-0 pt-1.5 px-3 pb-2.5 text-[13.5px] text-wiki-text">
                  {keyFacts.text.split("\n").map((line, i) => {
                    // A claim can span the label and value of one row, so a row
                    // carrying one stays a single highlightable unit rather than
                    // being split into bold label + value.
                    const hasClaim = claims.some(
                      (c) => c.spans[lang] && line.includes(c.spans[lang]!),
                    );
                    if (hasClaim) {
                      return (
                        <div
                          key={i}
                          className="kf-row kf-row-full block py-[5px] border-t border-wiki-rule first:border-t-0"
                        >
                          {highlight(line)}
                        </div>
                      );
                    }
                    const sep = line.indexOf(": ");
                    if (sep === -1) {
                      return (
                        <div
                          key={i}
                          className="kf-group pt-2 pb-0.5 font-bold text-center text-ink-soft"
                        >
                          {line}
                        </div>
                      );
                    }
                    return (
                      <div
                        key={i}
                        className="kf-row grid grid-cols-[minmax(0,38%)_minmax(0,1fr)] gap-y-0.5 gap-x-3 py-[5px] border-t border-wiki-rule first:border-t-0"
                      >
                        <dt className="kf-label m-0 font-bold">{line.slice(0, sep)}</dt>
                        <dd className="kf-value m-0">{line.slice(sep + 2)}</dd>
                      </div>
                    );
                  })}
                </dl>
              </details>
            )}
            {body.map((section, i) => (
              <div key={`${section.heading}-${i}`}>
                {section.heading !== LEAD_HEADING && (
                  <h3 className="section-heading mt-[26px] mb-2 pb-[5px] font-wiki-heading text-[21px] font-normal border-b border-wiki-border text-wiki-text">
                    {section.heading}
                  </h3>
                )}
                {highlight(section.text, section.links)}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
