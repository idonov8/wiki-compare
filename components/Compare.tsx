"use client";

import { useCallback, useEffect, useState } from "react";
import ArticlesSkeleton from "./ArticlesSkeleton";
import ArticleView from "./compare/ArticleView";
import CachedBadge from "./compare/CachedBadge";
import ClaimCard from "./compare/ClaimCard";
import ControlStrip from "./compare/ControlStrip";
import CreditsModal from "./CreditsModal";
import DiffNav from "./DiffNav";
import ErrorState from "./compare/ErrorState";
import FeedbackModal from "./FeedbackModal";
import Footer from "./Footer";
import Landing from "./landing/Landing";
import LangSwitch from "./LangSwitch";
import Loading from "./Loading";
import Masthead from "./compare/Masthead";
import { useOnboarding } from "./Onboarding";
import PreviewGate from "./PreviewGate";
import PreviewCta from "./compare/PreviewCta";
import PreviewFlag from "./compare/PreviewFlag";
import RunSummary from "./compare/RunSummary";
import SearchResults from "./compare/SearchResults";
import Sources from "./Sources";
import ThankYou from "./ThankYou";
import { useClaimCard } from "./compare/useClaimCard";
import { useCompareSession } from "./compare/useCompareSession";
import { useCreditsExplainer } from "./compare/useCreditsExplainer";
import { useEditions } from "./compare/useEditions";
import { useMe } from "./compare/useMe";
import { useRecent } from "./compare/useRecent";
import { initAnalytics, track } from "@/lib/analytics";
import { PRICE_PER_ARTICLE_CENTS } from "@/lib/pricing";
import { relative } from "@/lib/relative";
import { LANGS } from "@/lib/types";

export default function Compare() {
  const { me, refreshMe } = useMe();
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
    scope,
    funding,
    fundError,
    thanks,
    search,
    navigate,
    fund,
  } = useCompareSession({ refreshMe, onReset: hideCard });
  const { available, visible, solo, active, narrow, enterFrom, readIn, toggle, swipe } = useEditions({
    articles,
    article: target,
    onSwitch: hideCard,
  });
  const { recent, loading: recentLoading } = useRecent(phase === "idle");
  const explainer = useCreditsExplainer(me, phase);
  /** Which feature the onboarding dot is on — see components/Onboarding.tsx. */
  const onboarding = useOnboarding(me);
  /** Set once the landing page's own search field has scrolled out of reach. */
  const [docked, setDocked] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  useEffect(() => {
    initAnalytics();
  }, []);

  const goDonate = useCallback((from: string) => {
    void track("gate_cta_clicked", { from });
    window.location.href = `/donate?from=${encodeURIComponent(from)}`;
  }, []);

  const goFeedback = useCallback((from: string) => {
    void track("feedback_opened", { from });
    setFeedbackOpen(true);
  }, []);

  /** Off to sign in, and back to this exact article afterwards, so somebody who
   *  logged in from the gate lands on the comparison they were reading rather
   *  than on the front page having to find it again. */
  const goLogIn = useCallback((from: string) => {
    void track("gate_cta_clicked", { from });
    const back = window.location.pathname + window.location.search;
    window.location.href = `/login?next=${encodeURIComponent(back)}`;
  }, []);

  const comparing = phase === "comparing";
  const onArticle = comparing || phase === "done";
  const hasColumns = visible.length > 0;
  const landing = phase === "idle" && !error;
  const preview = scope?.kind === "preview";
  /** Whether pressing "donate this article" would actually read it, or has to
   *  ask for a login or a top-up first. Same three states the gate offers. */
  const canFund = !!me && me.creditCents >= PRICE_PER_ARTICLE_CENTS;
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
        me={me}
        onDonate={() => goDonate("masthead")}
        onLogIn={() => goLogIn("masthead")}
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
              {preview ? (
                // One flex item as far as the strip is concerned, so a narrow
                // screen can't wrap the flag onto its own line the way it would
                // two separate items — the note inside `PreviewCta` is what
                // gives, truncating before the flag ever loses its spot.
                <div className="flex min-w-0 grow items-center gap-x-[10px] max-cols:basis-full max-cols:gap-x-[8px]">
                  <PreviewCta
                    busy={funding}
                    signedIn={!!me}
                    canFund={canFund}
                    creditCents={me?.creditCents ?? 0}
                    onFund={() => void fund("full")}
                    onTopUp={() => goDonate("preview-strip")}
                    onLogIn={() => goLogIn("preview-strip")}
                  />
                  <PreviewFlag className="ml-auto shrink-0" />
                </div>
              ) : (
                <RunSummary claims={claims} data={data} />
              )}
              {stale && data?.cache && (
                <CachedBadge
                  cache={data.cache}
                  busy={funding}
                  signedIn={!!me}
                  onUpdate={() => void fund("refresh")}
                  onDonate={() => goDonate("stale-badge")}
                />
              )}
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
          onDonate={() => goDonate("landing_footer")}
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
          claims={claims}
          scope={scope}
          ghost={comparing && claims.length === 0}
          activeId={card?.claim.id ?? null}
          onEnter={showCard}
          onLeave={hideCard}
          onLink={navigate}
          gate={
            <PreviewGate
              busy={funding}
              signedIn={!!me}
              creditCents={me?.creditCents ?? 0}
              error={fundError}
              onFund={() => void fund("full")}
              onLogIn={() => goLogIn("preview-gate")}
              onTopUp={() => goDonate("preview-gate")}
            />
          }
        />
      )}

      {/* Under the article rather than beside it: what each version cites is an
          appendix, and it is the one part of this page that owes nothing to a
          model — so it stands whether the comparison above it was paid for, is
          still arriving, or stopped at the preview's fourth section. */}
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
          have arrived are already worth jumping between. `funding` covers the
          wait after donating, which buys the rest of the article in place. */}
      {claims.length > 0 && (onArticle || funding) && (
        <DiffNav
          // The claim count is in the signature because each one that lands
          // renders new marks, and the rail plots marks it has measured.
          signature={`${data?.qid ?? target?.title ?? ""}:${visible.join("")}:${claims.length}`}
          busy={comparing || funding}
        />
      )}

      {/* The landing page carries its own copy inside the grain overlay, so this
          is the footer for everything else — including a preview, where the
          faded remainder now stops rather than scrolling on into nothing. */}
      {!landing && (
        <Footer
          onDonate={() => goDonate("footer")}
          onFeedback={() => goFeedback("footer")}
          className={langSwitch ? "pb-[76px]" : ""}
        />
      )}

      {thanks && <ThankYou />}

      {explainer.explaining && me && data?.scope?.kind === "preview" && (
        <CreditsModal
          creditCents={me.creditCents}
          onProcess={() => {
            explainer.dismiss();
            void fund("full");
          }}
          onDismiss={explainer.dismiss}
        />
      )}

      {feedbackOpen && <FeedbackModal onDismiss={() => setFeedbackOpen(false)} />}

      {card && <ClaimCard card={card} />}
    </>
  );
}
