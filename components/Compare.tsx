"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Columns from "./Columns";
import { comparePath } from "./Highlighted";
import DiffNav from "./DiffNav";
import Loading from "./Loading";
import {
  LANGS,
  LANG_META,
  type ArticleSnapshot,
  type Claim,
  type ComparePayload,
  type Lang,
} from "@/lib/types";

const asLang = (value: string | null): Lang =>
  value && (LANGS as readonly string[]).includes(value) ? (value as Lang) : "en";

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

interface Hit {
  lang: string;
  title: string;
  description?: string;
  url: string;
}

/** Keep in sync with `.card { max-width }` in globals.css. */
const CARD_WIDTH = 340;
const CARD_MARGIN = 8;
/** Enough room to place the card below a mark without it running off-screen. */
const CARD_CLEARANCE = 190;

/**
 * The flow, and why it has this many steps: a comparison costs tokens and about
 * a minute, and every second of it is wasted if the subject was wrong. So the
 * article is chosen from search results, then read in full, and only then
 * compared — the reader confirms the right page by looking at it, not by
 * trusting a title match.
 */
type Phase = "idle" | "results" | "preview" | "comparing" | "done";

export default function Compare() {
  const [query, setQuery] = useState("Palestinian Legislative Council");
  const [phase, setPhase] = useState<Phase>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<Hit[]>([]);
  const [target, setTarget] = useState<Hit | null>(null);
  const [articles, setArticles] = useState<Record<string, ArticleSnapshot>>({});
  const [data, setData] = useState<ComparePayload | null>(null);
  const [shown, setShown] = useState<Lang[]>([...LANGS]);
  const [card, setCard] = useState<CardState | null>(null);

  const reset = () => {
    setError(null);
    setCard(null);
  };

  /** The querystring we last acted on, so a pushState of our own doesn't
   *  look like a navigation to re-apply. */
  const appliedUrl = useRef<string | null>(null);

  const runComparison = useCallback(async (hit: Hit) => {
    reset();
    setTarget(hit);
    setPhase("comparing");
    // Same article, now compared: replace rather than push, so Back leaves the
    // subject instead of stepping into its own preview.
    window.history.replaceState(null, "", comparePath(hit.title, hit.lang, true));
    appliedUrl.current = window.location.search;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/compare?title=${encodeURIComponent(hit.title)}&lang=${encodeURIComponent(hit.lang)}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Comparison failed.");
      setData(json as ComparePayload);
      setArticles(json.articles ?? {});
      setShown(LANGS.filter((l) => json.articles?.[l]));
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Comparison failed.");
      setPhase(Object.keys(articles).length ? "preview" : "idle");
    } finally {
      setBusy(false);
    }
  }, [articles]);

  /** Pull the chosen article in every language it exists in. No model, no
   *  tokens — and it warms the cache the comparison then reads. */
  const choose = useCallback(async (hit: Hit) => {
    reset();
    setTarget(hit);
    setArticles({});
    setData(null);
    setPhase("preview");
    setBusy(true);
    try {
      const res = await fetch(
        `/api/articles?title=${encodeURIComponent(hit.title)}&lang=${encodeURIComponent(hit.lang)}`,
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not load the articles.");
      setArticles(json.articles ?? {});
      setShown(LANGS.filter((l) => json.articles?.[l]));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the articles.");
      setPhase(hits.length ? "results" : "idle");
    } finally {
      setBusy(false);
    }
  }, [hits.length]);

  // The open article lives in the URL, so a preview or a comparison is linkable
  // and the back button works. Refs keep the popstate listener from being torn
  // down and re-run — re-running it would refetch the article on every change.
  const chooseRef = useRef(choose);
  const compareRef = useRef(runComparison);
  chooseRef.current = choose;
  compareRef.current = runComparison;

  const navigate = useCallback((title: string, lang: string) => {
    const t = title.trim();
    if (!t) return;
    setQuery(t);
    setHits([]);
    window.history.pushState(null, "", comparePath(t, lang));
    appliedUrl.current = window.location.search;
    window.scrollTo({ top: 0 });
    void chooseRef.current({ lang, title: t, url: "" });
  }, []);

  useEffect(() => {
    const apply = () => {
      if (window.location.search === appliedUrl.current) return;
      appliedUrl.current = window.location.search;
      const params = new URLSearchParams(window.location.search);
      const title = params.get("title");
      if (!title) {
        setPhase("idle");
        setArticles({});
        setData(null);
        setError(null);
        return;
      }
      setQuery(title);
      setHits([]);
      const hit = { lang: asLang(params.get("lang")), title, url: "" };
      // A shared link to a finished comparison shouldn't ask for the article to
      // be confirmed again; a bare title opens the preview.
      if (params.get("compare") === "1" || title.startsWith("demo:")) {
        void compareRef.current(hit);
      } else {
        void chooseRef.current(hit);
      }
    };
    apply();
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, []);

  const search = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    // The fixture route is a rendering harness, not a subject: it has no search
    // results and nothing to confirm, so it goes straight to the comparison.
    if (q.startsWith("demo:")) {
      const hit = { lang: "en", title: q, url: "" };
      setTarget(hit);
      setArticles({});
      void runComparison(hit);
      return;
    }

    reset();
    setBusy(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Search failed.");
      const results = (json.results ?? []) as Hit[];
      if (!results.length) throw new Error(`Nothing on Wikipedia matches “${q}”.`);
      setHits(results);
      // A pasted URL names one article, so there is nothing to pick between.
      if (json.exact) navigate(results[0].title, results[0].lang);
      else setPhase("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
      setPhase("idle");
    } finally {
      setBusy(false);
    }
  }, [query, navigate, runComparison]);

  const available = useMemo(
    () => LANGS.filter((l) => articles[l]),
    [articles],
  );
  const visible = shown.filter((l) => available.includes(l));
  const missing = LANGS.filter((l) => !available.includes(l));

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

  const hasColumns = visible.length > 0;
  const comparing = phase === "comparing";

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
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Article title, or paste a Wikipedia URL"
            aria-label="Article title"
          />
          <button onClick={search} disabled={busy}>
            {busy ? "Working…" : "Search"}
          </button>
        </div>
      </header>

      {(phase === "preview" || comparing || phase === "done") && hasColumns && (
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
            {data
              ? `${data.qid} · ${data.claims.length} marked · ${
                  data.fromCache
                    ? "cached, 0 tokens"
                    : `${data.usage.inputTokens.toLocaleString()} in / ${data.usage.outputTokens.toLocaleString()} out`
                }`
              : "not compared yet"}
          </div>
        </div>
      )}

      {error && (
        <div className="state error">
          <h2>That didn&apos;t work</h2>
          <p>{error}</p>
        </div>
      )}

      {phase === "idle" && !error && (
        <div className="state">
          <h2>Three encyclopedias, one subject</h2>
          <p>
            Search for an article, or paste a Wikipedia URL. You pick which article you meant and
            read it first; then the English, Hebrew and Arabic versions are compared, and every
            place they contradict each other, cover something the others skip, or frame the same
            fact differently is highlighted.
          </p>
          <p>
            Try <code>Palestinian Legislative Council</code>, <code>Six-Day War</code> or{" "}
            <code>Al-Aqsa Mosque</code>.
          </p>
        </div>
      )}

      {phase === "results" && (
        <div className="results">
          <h2>Which article did you mean?</h2>
          <p className="results-note">
            Results from {LANG_META[hits[0]?.lang as Lang]?.label ?? hits[0]?.lang} Wikipedia. The
            other languages are found through the article&apos;s Wikidata item.
          </p>
          <ul>
            {hits.map((hit) => (
              <li key={`${hit.lang}:${hit.title}`}>
                <button
                  className="hit"
                  onClick={() => navigate(hit.title, hit.lang)}
                  disabled={busy}
                >
                  <span className="hit-title">{hit.title}</span>
                  {hit.description && <span className="hit-desc">{hit.description}</span>}
                </button>
                <a className="hit-link" href={hit.url} target="_blank" rel="noreferrer">
                  open on Wikipedia ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {phase === "preview" && (
        <div className="confirm">
          <div className="confirm-text">
            <h2>{target?.title}</h2>
            <p>
              {busy
                ? "Loading the article in each language…"
                : `Found in ${available.map((l) => LANG_META[l].label).join(", ")}${
                    missing.length
                      ? ` — no ${missing.map((l) => LANG_META[l].label).join(" or ")} version`
                      : ""
                  }. Read it below, and compare when it's the right one.`}
            </p>
          </div>
          <div className="confirm-actions">
            {hits.length > 1 && (
              <button className="ghost-button" onClick={() => setPhase("results")}>
                Not this one
              </button>
            )}
            <button
              className="primary-button"
              onClick={() => target && runComparison(target)}
              disabled={busy || !hasColumns}
            >
              Compare these
            </button>
          </div>
        </div>
      )}

      {hasColumns && (phase === "preview" || comparing || phase === "done") && (
        <Columns
          articles={articles}
          visible={visible}
          claims={data?.claims ?? []}
          ghost={comparing}
          activeId={card?.claim.id ?? null}
          onEnter={onEnter}
          onLeave={() => setCard(null)}
          onLink={navigate}
        />
      )}

      {comparing && <Loading title={target?.title ?? ""} />}

      {phase === "done" && data && (
        <>
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
