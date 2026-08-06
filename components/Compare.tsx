"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Highlighted, { comparePath } from "./Highlighted";
import DiffNav from "./DiffNav";
import Loading from "./Loading";
import {
  CACHE_WINDOW_DAYS,
  KEY_FACTS_HEADING,
  LANGS,
  LANG_META,
  LEAD_HEADING,
  type CacheInfo,
  type Claim,
  type ComparePayload,
  type Lang,
  type LinkSpan,
  type RecentArticle,
} from "@/lib/types";

const asLang = (value: string | null): Lang =>
  value && (LANGS as readonly string[]).includes(value) ? (value as Lang) : "en";

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 hours ago" / "in 2 days", at the coarsest unit that still says something. */
function relative(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const [unit, size]: [Intl.RelativeTimeFormatUnit, number] =
    abs < 3_600_000 ? ["minute", 60_000] : abs < 86_400_000 ? ["hour", 3_600_000] : ["day", 86_400_000];
  return RELATIVE.format(Math.round(ms / size), unit);
}

/** What the `cached` badge says on hover: which versions moved, and until when
 *  this answer keeps being served in their place. */
function cacheNote(cache: CacheInfo): string {
  const names = cache.edited.map((l) => LANG_META[l].label);
  const subject =
    names.length === 1
      ? `The ${names[0]} article has`
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} have`;
  return (
    `${subject} been edited on Wikipedia since this comparison was computed ${relative(cache.computedAt)}. ` +
    `A comparison is reused for ${CACHE_WINDOW_DAYS} days, so these columns show the cached text rather ` +
    `than what is live now. Recomputed on the first request ${relative(cache.expiresAt)}.`
  );
}

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
  const [recent, setRecent] = useState<RecentArticle[]>([]);

  const load = useCallback(async (raw: string, sourceLang: Lang = "en") => {
    const title = raw.trim();
    if (!title) return;
    setPending(title);
    setLoading(true);
    setError(null);
    setCard(null);
    try {
      const res = await fetch(
        `/api/compare?title=${encodeURIComponent(title)}&lang=${sourceLang}`,
      );
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
  }, []);

  // The open article lives in the URL, so a comparison is linkable and the back
  // button works. Clicking a wiki link or submitting the box pushes a new entry.
  const navigate = useCallback(
    (raw: string, sourceLang: Lang = "en") => {
      const title = raw.trim();
      if (!title) return;
      setQuery(title);
      window.history.pushState(null, "", comparePath(title, sourceLang));
      window.scrollTo({ top: 0 });
      load(title, sourceLang);
    },
    [load],
  );

  useEffect(() => {
    const apply = () => {
      const params = new URLSearchParams(window.location.search);
      const title = params.get("title");
      if (title) {
        setQuery(title);
        load(title, asLang(params.get("lang")));
      } else {
        setData(null);
        setError(null);
      }
    };
    apply();
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, [load]);

  // Refreshed on every return to the empty state, so an article compared and
  // then backed out of is at the top of the list waiting. Reading the URL rather
  // than trusting `idle` alone keeps a deep link from spending a request on a
  // list it will never show: on that first render nothing has loaded yet, so the
  // state is indistinguishable from an ordinary cold landing.
  const idle = !data && !error && !loading;
  useEffect(() => {
    if (!idle || new URLSearchParams(window.location.search).get("title")) return;
    const abort = new AbortController();
    fetch("/api/recent", { signal: abort.signal })
      .then((res) => res.json())
      .then((json) => setRecent(json.items ?? []))
      .catch(() => {});
    return () => abort.abort();
  }, [idle]);

  const available = useMemo(() => LANGS.filter((l) => data?.articles?.[l]), [data]);
  const visible = shown.filter((l) => available.includes(l));
  const badged = !!data?.cache && data.cache.edited.length > 0;

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
            onKeyDown={(e) => e.key === "Enter" && navigate(query)}
            placeholder="Article title in English, Hebrew or Arabic"
            aria-label="Article title"
          />
          <button onClick={() => navigate(query)} disabled={loading}>
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
            {/* The badge says "cached" in its own right, so the cost note drops
                the word rather than printing it twice in four words. */}
            {data.fromCache
              ? badged
                ? "0 tokens"
                : "cached, 0 tokens"
              : `${data.usage.inputTokens.toLocaleString()} in / ${data.usage.outputTokens.toLocaleString()} out`}
            {/* Only when the cached answer and Wikipedia have actually diverged.
                An exact-revision hit is cached too, but it describes the live
                text, so badging it would cry wolf on the ordinary case. */}
            {badged && data.cache && (
              <span className="cached-badge" tabIndex={0} aria-describedby="cached-tip">
                cached
                <span className="cached-tip" id="cached-tip" role="tooltip">
                  {cacheNote(data.cache)}
                </span>
              </span>
            )}
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

      {idle && (
        <div className="state">
          <h2>Three encyclopedias, one subject</h2>
          <p>
            Enter an article title. The English, Hebrew and Arabic versions load side by side, and
            every place they contradict each other, cover something the others skip, or frame the
            same fact differently is highlighted. Hover a highlight to see what the difference is.
          </p>
          {/* Already-compared articles, carrying no heading of their own: the
              rows are self-evidently a list of articles, and the hand-picked
              suggestions are only worth the space while there is nothing here. */}
          {recent.length > 0 ? (
            <ul className="recent">
              {recent.map((item) => (
                <li key={item.qid}>
                  <button
                    type="button"
                    onClick={() => navigate(item.title, item.lang)}
                    aria-label={`Compare ${item.title}, cached ${relative(item.computedAt)}`}
                  >
                    <span
                      className="recent-title"
                      dir={LANG_META[item.lang].dir}
                      lang={item.lang}
                    >
                      {item.title}
                    </span>
                    <span className="recent-langs">
                      {item.langs.map((l) => l.toUpperCase()).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              Try <code>Palestinian Legislative Council</code>, <code>Six-Day War</code> or{" "}
              <code>Al-Aqsa Mosque</code>.
            </p>
          )}
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
              const keyFacts = article.sections.find((s) => s.heading === KEY_FACTS_HEADING);
              const body = article.sections.filter((s) => s.heading !== KEY_FACTS_HEADING);
              const highlight = (text: string, links?: LinkSpan[]) => (
                <Highlighted
                  text={text}
                  lang={lang}
                  claims={data.claims}
                  links={links}
                  activeId={card?.claim.id ?? null}
                  onEnter={onEnter}
                  onLeave={() => setCard(null)}
                  onLink={navigate}
                />
              );
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
                  <h1 className="article-title">{article.title}</h1>
                  {article.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      className="article-image"
                      src={article.image.src}
                      alt={article.image.alt ?? article.title}
                      loading="lazy"
                    />
                  )}
                  {keyFacts && (
                    <details className="key-facts">
                      <summary>Key facts</summary>
                      <dl className="kf-body">
                        {keyFacts.text.split("\n").map((line, i) => {
                          // A claim can span the label and value of one row, so a
                          // row carrying one stays a single highlightable unit
                          // rather than being split into bold label + value.
                          const hasClaim = data.claims.some(
                            (c) => c.spans[lang] && line.includes(c.spans[lang]!),
                          );
                          if (hasClaim) {
                            return (
                              <div key={i} className="kf-row kf-row-full">
                                {highlight(line)}
                              </div>
                            );
                          }
                          const sep = line.indexOf(": ");
                          if (sep === -1) {
                            return (
                              <div key={i} className="kf-group">
                                {line}
                              </div>
                            );
                          }
                          return (
                            <div key={i} className="kf-row">
                              <dt className="kf-label">{line.slice(0, sep)}</dt>
                              <dd className="kf-value">{line.slice(sep + 2)}</dd>
                            </div>
                          );
                        })}
                      </dl>
                    </details>
                  )}
                  {body.map((section, i) => (
                    <div key={`${section.heading}-${i}`}>
                      {section.heading !== LEAD_HEADING && (
                        <h3 className="section-heading">{section.heading}</h3>
                      )}
                      {highlight(section.text, section.links)}
                    </div>
                  ))}
                </section>
              );
            })}
          </div>

          {data.claims.length > 0 && <DiffNav signature={`${data.qid}:${visible.join("")}`} />}

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
