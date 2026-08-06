"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Columns from "./Columns";
import { comparePath } from "./Highlighted";
import DiffNav from "./DiffNav";
import Loading from "./Loading";
import {
  CACHE_WINDOW_DAYS,
  LANGS,
  LANG_META,
  type ArticleSnapshot,
  type CacheInfo,
  type Claim,
  type ComparePayload,
  type Lang,
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
    `${subject} been edited on Wikipedia since this comparison was processed ${relative(cache.computedAt)}. ` +
    `Donate to update this page.`
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
 * A comparison costs tokens and about a minute, and every second of it is
 * wasted if the subject was wrong — so the article is chosen from search
 * results rather than guessed from the box. The choice starts the comparison
 * immediately, and the article itself is what fills the wait: it is fetched in
 * parallel and on screen within a second, so the reader can see they picked the
 * right page while the model is still reading it.
 */
type Phase = "idle" | "results" | "comparing" | "done";

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
  const [recent, setRecent] = useState<RecentArticle[]>([]);

  const reset = () => {
    setError(null);
    setCard(null);
  };

  /** The querystring we last acted on, so a pushState of our own doesn't
   *  look like a navigation to re-apply. */
  const appliedUrl = useRef<string | null>(null);

  /**
   * Open an article: the comparison and the articles alone are requested at the
   * same time. `/api/articles` answers in about a second and fills the columns;
   * `/api/compare` takes a minute and only adds the marks — and it reads the
   * same cache the first request just warmed, so the pair costs one fetch.
   */
  const open = useCallback(async (hit: Hit) => {
    reset();
    setTarget(hit);
    setArticles({});
    setData(null);
    setPhase("comparing");

    const compare = fetch(
      `/api/compare?title=${encodeURIComponent(hit.title)}&lang=${encodeURIComponent(hit.lang)}`,
    ).then(async (res) => {
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Comparison failed.");
      return json as ComparePayload;
    });
    compare.catch(() => {}); // handled below; this only keeps an early reject quiet

    try {
      const res = await fetch(
        `/api/articles?title=${encodeURIComponent(hit.title)}&lang=${encodeURIComponent(hit.lang)}`,
      );
      const json = await res.json();
      if (res.ok) {
        setArticles(json.articles ?? {});
        setShown(LANGS.filter((l) => json.articles?.[l]));
      }
      // A failure here isn't fatal: the comparison returns the articles too, and
      // its own error is the one worth showing.
    } catch {}

    try {
      const json = await compare;
      setData(json);
      setArticles(json.articles ?? {});
      setShown(LANGS.filter((l) => json.articles?.[l]));
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Comparison failed.");
      setPhase(hits.length ? "results" : "idle");
    }
  }, [hits.length]);

  // The open article lives in the URL, so a comparison is linkable and the back
  // button works. A ref keeps the popstate listener from being torn down and
  // re-run — re-running it would refetch the article on every state change.
  const openRef = useRef(open);
  openRef.current = open;

  const navigate = useCallback((title: string, lang: string) => {
    const t = title.trim();
    if (!t) return;
    setQuery(t);
    setHits([]);
    window.history.pushState(null, "", comparePath(t, lang));
    appliedUrl.current = window.location.search;
    window.scrollTo({ top: 0 });
    void openRef.current({ lang, title: t, url: "" });
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
      void openRef.current({ lang: asLang(params.get("lang")), title, url: "" });
    };
    apply();
    window.addEventListener("popstate", apply);
    return () => window.removeEventListener("popstate", apply);
  }, []);

  // Refreshed on every return to the landing state, so an article compared and
  // then backed out of is at the top of the list waiting. Reading the URL rather
  // than trusting the phase alone keeps a deep link from spending a request on a
  // list it will never show: `idle` is also the phase of the first render before
  // the effect above has opened the article named in the querystring.
  useEffect(() => {
    if (phase !== "idle" || new URLSearchParams(window.location.search).get("title")) return;
    const abort = new AbortController();
    fetch("/api/recent", { signal: abort.signal })
      .then((res) => res.json())
      .then((json) => setRecent(json.items ?? []))
      .catch(() => {});
    return () => abort.abort();
  }, [phase]);

  const search = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    // The fixture route is a rendering harness, not a subject: it has no search
    // results to pick from, so it is opened directly.
    if (q.startsWith("demo:")) {
      navigate(q, "en");
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
  }, [query, navigate]);

  const available = useMemo(
    () => LANGS.filter((l) => articles[l]),
    [articles],
  );
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

      {(comparing || phase === "done") && hasColumns && (
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
            {/* The badge says "cached" in its own right, so the cost note drops
                the word rather than printing it twice in four words. */}
            {data
              ? `${data.qid} · ${data.claims.length} marked · ${
                  data.fromCache
                    ? badged
                      ? "0 tokens"
                      : "cached, 0 tokens"
                    : `${data.usage.inputTokens.toLocaleString()} in / ${data.usage.outputTokens.toLocaleString()} out`
                }`
              : "reading all three…"}
            {/* Only when the cached answer and Wikipedia have actually diverged.
                An exact-revision hit is cached too, but it describes the live
                text, so badging it would cry wolf on the ordinary case. */}
            {badged && data?.cache && (
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
            Search for an article, or paste a Wikipedia URL, and pick which article you meant. The
            English, Hebrew and Arabic versions appear side by side while they are compared, and
            every place they contradict each other, cover something the others skip, or frame the
            same fact differently is highlighted.
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

      {hasColumns && (comparing || phase === "done") && (
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
