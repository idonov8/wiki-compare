"use client";

import Highlighted from "./Highlighted";
import {
  KEY_FACTS_HEADING,
  LANG_META,
  LEAD_HEADING,
  type ArticleSnapshot,
  type Claim,
  type Lang,
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
  onEnter,
  onLeave,
}: {
  articles: Record<string, ArticleSnapshot>;
  visible: Lang[];
  claims: Claim[];
  ghost?: boolean;
  activeId?: string | null;
  onEnter?: (claim: Claim, event: React.MouseEvent | React.FocusEvent) => void;
  onLeave?: () => void;
}) {
  return (
    <div
      className="columns"
      style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}
    >
      {visible.map((lang) => {
        const article = articles[lang];
        if (!article) return null;
        const meta = LANG_META[lang];
        return (
          <section key={lang} className="column" dir={meta.dir} lang={lang}>
            <div className="column-head">
              <span className="native">{meta.native}</span>
              <span className="arrow" aria-hidden="true">
                {meta.dir === "rtl" ? "←" : "→"}
              </span>
              <a href={article.url} target="_blank" rel="noreferrer">
                rev {article.revid}
              </a>
            </div>
            <h2 className="article-title">{article.title}</h2>
            {article.sections.map((section, i) => (
              <div
                key={i}
                className={section.heading === KEY_FACTS_HEADING ? "key-facts" : undefined}
              >
                {section.heading === KEY_FACTS_HEADING ? (
                  <h3 className="section-heading synthetic">Key facts</h3>
                ) : (
                  section.heading !== LEAD_HEADING && (
                    <h3 className="section-heading">{section.heading}</h3>
                  )
                )}
                <Highlighted
                  text={section.text}
                  lang={lang}
                  claims={claims}
                  ghost={ghost}
                  activeId={activeId}
                  onEnter={onEnter}
                  onLeave={onLeave}
                />
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}
