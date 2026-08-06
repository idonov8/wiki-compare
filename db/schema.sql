-- Parsed article text, keyed by revision id. Revision ids are immutable, so
-- rows here are written once and never updated or expired.
-- parser_version is part of the key because only the *input* is immutable, not
-- our reading of it. Keyed on revision id alone, a parser fix would be invisible
-- to every article already cached: the revision has not changed, so the stale
-- snapshot keeps being served and the fix appears not to have worked.
CREATE TABLE IF NOT EXISTS articles (
  lang           TEXT        NOT NULL,
  revid          BIGINT      NOT NULL,
  parser_version TEXT        NOT NULL,
  title          TEXT        NOT NULL,
  snapshot       JSONB       NOT NULL,
  fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lang, revid, parser_version)
);

-- Migration for databases created before parser_version existed. Both are
-- no-ops on a fresh database and on an already-migrated one.
ALTER TABLE articles ADD COLUMN IF NOT EXISTS parser_version TEXT NOT NULL DEFAULT 'v1';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'articles_pkey' AND conrelid = 'articles'::regclass
      AND array_length(conkey, 1) = 2
  ) THEN
    ALTER TABLE articles DROP CONSTRAINT articles_pkey;
    ALTER TABLE articles ADD PRIMARY KEY (lang, revid, parser_version);
  END IF;
END $$;

-- Comparison output, keyed by every participating revision id plus the prompt
-- version. A steady-state article costs zero tokens on every request after the
-- first one.
CREATE TABLE IF NOT EXISTS comparisons (
  cache_key   TEXT        PRIMARY KEY,
  qid         TEXT        NOT NULL,
  result      JSONB       NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comparisons_qid_idx ON comparisons (qid);

-- Serves both the "recently cached" list on the landing page and the freshness
-- window: a comparison stays servable for three days even after the underlying
-- revision ids move on, so an edit on Wikipedia doesn't force a re-read.
CREATE INDEX IF NOT EXISTS comparisons_computed_at_idx ON comparisons (computed_at DESC);

-- Wikidata labels for the coverage diff. Cheap to refill, safe to truncate.
CREATE TABLE IF NOT EXISTS labels (
  qid   TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

-- Better Auth's own tables — user, session, account, verification — are not in
-- this file. Its CLI generates and migrates them from lib/auth.ts, and two tools
-- issuing DDL for the same table is how the two descriptions start to disagree,
-- silently, in whichever environment happened to run them in the other order.

-- Every attempt to donate, funded or not.
--
-- The unfunded rows are the point of the table rather than noise in it. Credit
-- is granted once per account, so a second attempt records granted_cents = 0 and
-- is still worth keeping: people reaching the payment page and going through
-- with it is the only evidence there is for whether this is worth continuing,
-- and a table that stores just the grants cannot answer that.
--
-- user_id is TEXT and carries no foreign key to Better Auth's user(id), on
-- purpose. That table is migrated by a different tool on its own schedule, so a
-- cross-tool foreign key makes whichever migration runs first fail — this one
-- against a table that does not exist yet, or theirs against a dependency it
-- does not know about. This ledger is append-only and never joined for
-- correctness, so a dangling id after a deleted account is a cheaper failure
-- than a boot-order dependency between two migration systems.
CREATE TABLE IF NOT EXISTS donations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, maintenance_cents INTEGER NOT NULL DEFAULT 0,
  monthly BOOLEAN NOT NULL DEFAULT false, coupon TEXT,
  granted_cents INTEGER NOT NULL, mock BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The other side of the ledger: one row per comparison somebody's credit paid
-- for. charged_cents is the flat article price and actual_cost_cents is what the
-- tokens really came to, kept apart so the gap between them stays visible — it
-- is the only thing that says whether the price is set anywhere near right.
-- Same TEXT user_id, for the same reason as above.
CREATE TABLE IF NOT EXISTS spends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  qid TEXT NOT NULL, cache_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  charged_cents INTEGER NOT NULL, actual_cost_cents INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS donations_user_idx ON donations (user_id);
CREATE INDEX IF NOT EXISTS spends_user_idx    ON spends (user_id);

-- Who paid for a cached comparison, and how many people have read it since.
-- Together they are what a donor is shown in return: not "you spent $2" but
-- "ten articles, read ninety times". Defaulting served_count to 0 rather than 1
-- keeps the counter meaning reads served from cache, which is the number that
-- makes the donation worth more than the one article that prompted it.
ALTER TABLE comparisons ADD COLUMN IF NOT EXISTS served_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comparisons ADD COLUMN IF NOT EXISTS funded_by TEXT;
