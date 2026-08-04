"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Highlighted from "./Highlighted";
import Loading from "./Loading";
import {
  KEY_FACTS_HEADING,
  LANGS,
  LANG_META,
  LEAD_HEADING,
  type Claim,
  type ComparePayload,
  type Lang,
} from "@/lib/types";

const KIND_LABEL: Record<Claim["type"], string> = {
  contradiction: "Contradiction",
  unique: "Only in one version",
  framing: "Different framing",
};

interface CardState {
  claim: Claim;
  left: number;
  /** Exactly one of these is set: `bottom` anchors the card above the mark. */
  top?: number;
  bottom?: number;
}

/** Keep in sync with `.card { max-width }` in globals.css. */
const CARD_WIDTH = 340;
const CARD_MARGIN = 8;
/** Enough room to place the card below a mark without it running off-screen. */
const CARD_CLEARANCE = 190;

export default function Compare() {
  const [query, setQuery] = useState("Palestinian Legislative Council");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ComparePayload | null>(null);
  /** The title actually submitted, so the loading state does not retitle itself
   *  as someone edits the box while a comparison is in flight. */
  const [pending, setPending] = useState("");
  const [shown, setShown] = useState<Lang[]>([...LANGS]);
  const [card, setCard] = useState<CardState | null>(null);

  const load = useCallback(async () => {
    const title = query.trim();
    if (!title) return;
    setPending(title);
    setLoading(true);
    setError(null);
    setCard(null);
    try {
      const res = await fetch(`/api/compare?title=${encodeURIComponent(title)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Comparison failed.");
      setData(json as ComparePayload);
      setShown(LANGS.filter((l) => json.articles?.[l]));
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Comparison failed.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  const available = useMemo(() => LANGS.filter((l) => data?.articles?.[l]), [data]);
  const visible = shown.filter((l) => available.includes(l));

  // A tooltip reached by keyboard needs a way out that isn't Tab. Blur alone
  // leaves someone who opened the card with focus no way to dismiss it in place.
  useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCard(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [card]);

  const toggle = (lang: Lang) =>
    setShown((current) =>
      current.includes(lang)
        ? current.length > 1
          ? current.filter((l) => l !== lang)
          : current
        : [...current, lang].sort((a, b) => LANGS.indexOf(a) - LANGS.indexOf(b)),
    );

  const onEnter = (claim: Claim, event: React.MouseEvent | React.FocusEvent) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();

    // Clamp both edges. Clamping only the right edge pushed the card off-screen
    // for a mark near the left of the viewport, which the rightmost column makes
    // likelier once it is the only one shown.
    const left = Math.max(
      CARD_MARGIN,
      Math.min(rect.left, window.innerWidth - CARD_WIDTH - CARD_MARGIN),
    );

    // Anchoring by `bottom` when flipping is what makes the flip real: setting
    // `top` to just above the mark still lays the card out downwards, so it
    // covered the very text it was explaining. This needs no height measurement.
    const flip = rect.bottom + CARD_CLEARANCE > window.innerHeight;
    setCard(
      flip
        ? { claim, left, bottom: window.innerHeight - rect.top + CARD_MARGIN }
        : { claim, left, top: rect.bottom + CARD_MARGIN },
    );
  };

  return (
    <>
      <header className="masthead">
        <div className="wordmark">
          wiki<span>-</span>compare
        </div>
        <div className="search">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="Article title in English, Hebrew or Arabic"
            aria-label="Article title"
          />
          <button onClick={load} disabled={loading}>
            {loading ? "Comparing…" : "Compare"}
          </button>
        </div>
      </header>

      {data && !loading && (
        <div className="controls">
          <div className="toggles">
            {available.map((lang) => (
              <button
                key={lang}
                className="toggle"
                aria-pressed={visible.includes(lang)}
                onClick={() => toggle(lang)}
              >
                {lang.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="legend">
            <span><i className="swatch contradiction" /> contradiction</span>
            <span><i className="swatch unique" /> only in one version</span>
            <span><i className="swatch framing" /> different framing</span>
          </div>
          <div className="meta">
            {data.qid} · {data.claims.length} marked ·{" "}
            {data.fromCache
              ? "cached, 0 tokens"
              : `${data.usage.inputTokens.toLocaleString()} in / ${data.usage.outputTokens.toLocaleString()} out`}
          </div>
        </div>
      )}

      {loading && <Loading title={pending} />}

      {error && !loading && (
        <div className="state error">
          <h2>That didn&apos;t work</h2>
          <p>{error}</p>
        </div>
      )}

      {!data && !error && !loading && (
        <div className="state">
          <h2>Three encyclopedias, one subject</h2>
          <p>
            Enter an article title. The English, Hebrew and Arabic versions load side by side, and
            every place they contradict each other, cover something the others skip, or frame the
            same fact differently is underlined. Hover an underline to see what the difference is.
          </p>
          <p>
            Try <code>Palestinian Legislative Council</code>, <code>Six-Day War</code> or{" "}
            <code>Al-Aqsa Mosque</code>.
          </p>
        </div>
      )}

      {data && !loading && (
        <>
          <div
            className="columns"
            style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}
          >
            {visible.map((lang) => {
              const article = data.articles[lang];
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
                  {article.sections.map((section, i) => (
                    <div key={i} className={section.heading === KEY_FACTS_HEADING ? "key-facts" : undefined}>
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
                        claims={data.claims}
                        activeId={card?.claim.id ?? null}
                        onEnter={onEnter}
                        onLeave={() => setCard(null)}
                      />
                    </div>
                  ))}
                </section>
              );
            })}
          </div>

          {data.coverage.length > 0 && (
            <div className="coverage">
              <h2>Covered in some versions, not others</h2>
              <p>
                Linked concepts one version mentions and another never does. Computed by set
                arithmetic over Wikidata identifiers, so no model reads a word of this.
              </p>
              <div className="gaps">
                {data.coverage.map((gap) => (
                  <span key={gap.qid} className="gap">
                    {gap.label} <b>{gap.presentIn.join("+")} only</b>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {card && (
        <div
          className="card"
          id="claim-card"
          style={{ left: card.left, top: card.top, bottom: card.bottom }}
          role="tooltip"
        >
          <span className="kind" data-type={card.claim.type}>
            {KIND_LABEL[card.claim.type]}
          </span>
          <span className="summary">{card.claim.summary}</span>
          <span className="explanation">{card.claim.explanation}</span>
          <div className="also">
            marked in {Object.keys(card.claim.spans).map((l) => l.toUpperCase()).join(", ")}
          </div>
        </div>
      )}
    </>
  );
}
