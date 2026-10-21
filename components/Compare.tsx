"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ArticlesSkeleton from "./ArticlesSkeleton";
import ArticleView from "./compare/ArticleView";
import CachedBadge from "./compare/CachedBadge";
import ClaimCard from "./compare/ClaimCard";
import CounterpartPanel from "./compare/CounterpartPanel";
import ControlStrip from "./compare/ControlStrip";
import DiffNav from "./DiffNav";
import ErrorState from "./compare/ErrorState";
import FeedbackModal from "./FeedbackModal";
import Footer from "./Footer";
import Landing from "./landing/Landing";
import LangSwitch from "./LangSwitch";
import Loading from "./Loading";
import Masthead from "./compare/Masthead";
import { useOnboarding } from "./Onboarding";
import RunSummary from "./compare/RunSummary";
import SearchResults from "./compare/SearchResults";
import Sources from "./Sources";
import { useClaimCard } from "./compare/useClaimCard";
import { sentenceKey, useCounterpart } from "./compare/useCounterpart";
import { useCompareSession } from "./compare/useCompareSession";
import { useEditions } from "./compare/useEditions";
import { useRecent } from "./compare/useRecent";
import { initAnalytics, track } from "@/lib/analytics";
import { relative } from "@/lib/relative";
import { salientClaims } from "@/lib/salience";
import { LANGS, type AlignedSentence, type Claim, type Lang } from "@/lib/types";

const SHOW_ALL_KEY = "show-all-differences";

export default function Compare() {
  const { card, show: showCard, hide: hideCard } = useClaimCard();
  const {
    query,
    setQuery,
    phase,
    busy,
    error,
    hits,
    target,
    articles,
    data,
    claims,
    search,
    navigate,
  } = useCompareSession({ onReset: hideCard });
  const { available, visible, solo, active, narrow, enterFrom, readIn, toggle, swipe } = useEditions({
    articles,
    article: target,
    onSwitch: hideCard,
  });
  const { recent, loading: recentLoading } = useRecent(phase === "idle");
  /** Which feature the onboarding dot is on — see components/Onboarding.tsx. */
  const onboarding = useOnboarding();
  /** Set once the landing page's own search field has scrolled out of reach. */
  const [docked, setDocked] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    try {
      setShowAll(window.localStorage.getItem(SHOW_ALL_KEY) === "1");
    } catch {}
  }, []);

  const toggleShowAll = useCallback(() => {
    setShowAll((was) => {
      const now = !was;
      try {
        window.localStorage.setItem(SHOW_ALL_KEY, now ? "1" : "0");
      } catch {}
      void track("show_all_toggled", { on: now });
      return now;
    });
  }, []);

  /** The differences worth drawing by default; see lib/salience.ts. */
  const salient = useMemo(() => (data ? salientClaims(claims, articles) : null), [data, claims, articles]);
  const shown = useMemo(
    () => (showAll || !salient ? claims : claims.filter((c) => salient.has(c.id))),
    [showAll, salient, claims],
  );

  const alignment = data?.alignment;
  const rows = useMemo(() => {
    const out = new Map<string, { lang: Lang; row: AlignedSentence }>();
    for (const [lang, list] of Object.entries(alignment ?? {}) as [Lang, AlignedSentence[]][]) {
      for (const row of list) out.set(sentenceKey(lang, row.section, row.start), { lang, row });
    }
    return out;
  }, [alignment]);
  const claimBySentence = useMemo(() => {
    const out = new Map<string, Claim>();
    for (const claim of shown) {
      for (const [lang, ref] of Object.entries(claim.refs ?? {})) {
        out.set(sentenceKey(lang as Lang, ref.section, ref.start), claim);
      }
    }
    return out;
  }, [shown]);
  const claimAt = useCallback((key: string) => claimBySentence.get(key), [claimBySentence]);
  const { counterpart, show: showCounterpart, leave: leaveCounterpart, close: closeCounterpart } = useCounterpart(
    rows,
    claimAt,
  );

  useEffect(() => closeCounterpart(), [data?.qid, target?.title, closeCounterpart]);

  useEffect(() => {
    initAnalytics();
  }, []);

  const goFeedback = useCallback((from: string) => {
    void track("feedback_opened", { from });
    setFeedbackOpen(true);
  }, []);

  const comparing = phase === "comparing";
  const onArticle = comparing || phase === "done";
  const hasColumns = visible.length > 0;
  const landing = phase === "idle" && !error;
  const stale = !!data?.cache && data.cache.edited.length > 0;
  /** Whether the floating language switch is over the bottom of the page, which
   *  the footer has to keep its last line clear of. */
  const langSwitch = narrow && !!solo && hasColumns && onArticle && available.length > 1;
  /** The one-column state, shared by the article and the sources under it. */
  const slide = { narrow, solo, enterFrom, swipe };

  return (
    <>
      <Masthead
        sticky={landing}
        showSearch={!landing || docked}
        query={query}
        onQueryChange={setQuery}
        onSearch={search}
        busy={busy}
        onFeedback={() => goFeedback("masthead")}
      />

      {onArticle && hasColumns && (
        <ControlStrip
          langs={available}
          articles={articles}
          onScreen={visible}
          onPick={narrow ? readIn : toggle}
          onboarding={onboarding}
          meta={
            <>
              <RunSummary claims={shown} data={data} />
              {salient && salient.size < claims.length && (
                <button
                  type="button"
                  className="show-all shrink-0 underline decoration-dotted underline-offset-2 text-ink-soft hover:text-ink cursor-pointer"
                  onClick={toggleShowAll}
                  aria-pressed={showAll}
                >
                  {showAll
                    ? `showing all ${claims.length} · fewer`
                    : `${salient.size} of ${claims.length} shown · show all`}
                </button>
              )}
              {stale && data?.cache && <CachedBadge cache={data.cache} />}
            </>
          }
        />
      )}

      {error && <ErrorState message={error} />}

      {/* The landing page holds none of the state above — the query, the search
          and the URL all stay here, and it works entirely through the callbacks
          below, which is what keeps its sections safe to restyle without going
          near the diff renderer. */}
      {landing && (
        <Landing
          query={query}
          setQuery={setQuery}
          onSearch={search}
          onOpen={navigate}
          busy={busy}
          recent={recent}
          recentLoading={recentLoading}
          relative={relative}
          onFeedback={() => goFeedback("landing_footer")}
          onDocked={setDocked}
        />
      )}

      {phase === "results" && <SearchResults hits={hits} busy={busy} onPick={navigate} />}

      {onArticle && hasColumns && (
        <ArticleView
          slide={slide}
          articles={articles}
          visible={visible}
          claims={shown}
          ghost={comparing && claims.length === 0}
          activeId={card?.claim.id ?? counterpart?.claim?.id ?? null}
          alignment={alignment}
          activeSentence={counterpart?.key ?? null}
          // With an alignment the panel shows a mark's difference along with the
          // passage it sits in, so the separate card would only cover it.
          onEnter={alignment ? undefined : showCard}
          onLeave={hideCard}
          onLink={navigate}
          onSentence={showCounterpart}
          onSentenceLeave={leaveCounterpart}
        />
      )}

      {/* Under the article rather than beside it: what each version cites is an
          appendix, and it is the one part of this page that owes nothing to a
          model — so it stands whether the comparison above it is finished or
          still arriving. */}
      {onArticle && hasColumns && (
        <Sources articles={articles} visible={visible} slide={slide} qid={data?.qid} />
      )}

      {/* The second or so before the stream answers, when the page would
          otherwise be a masthead over nothing. All three editions are drawn
          because which ones this subject actually has is one of the things the
          fetch is about to say; a column for an edition that turns out not to
          exist simply doesn't arrive. */}
      {comparing && !hasColumns && <ArticlesSkeleton langs={narrow ? [active] : [...LANGS]} />}

      {langSwitch && <LangSwitch langs={available} active={solo!} onChange={readIn} />}

      {/* The panel hands over to the stepper the moment there is something to
          step through. Until then it is the only thing that can say what is
          happening; after, it would be prose about work the reader can watch. */}
      {comparing && claims.length === 0 && (
        <Loading title={target?.title ?? ""} reading={hasColumns} />
      )}

      {/* Live during the read as well: differences stream in, and the ones that
          have arrived are already worth jumping between. */}
      {shown.length > 0 && onArticle && (
        <DiffNav
          // The claim count is in the signature because each one that lands
          // renders new marks, and the rail plots marks it has measured.
          signature={`${data?.qid ?? target?.title ?? ""}:${visible.join("")}:${shown.length}`}
          busy={comparing}
          hint={onboarding.step === "sources"}
          onHintDone={onboarding.done}
        />
      )}

      {/* The landing page carries its own copy inside the grain overlay, so this
          is the footer for everything else. */}
      {!landing && (
        <Footer onFeedback={() => goFeedback("footer")} className={langSwitch ? "pb-[76px]" : ""} />
      )}

      {feedbackOpen && <FeedbackModal onDismiss={() => setFeedbackOpen(false)} />}

      {card && <ClaimCard card={card} />}

      {counterpart && (
        <CounterpartPanel state={counterpart} articles={articles} cacheKey={data?.cacheKey} onClose={closeCounterpart} />
      )}
    </>
  );
}
