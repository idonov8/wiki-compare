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

-- The reference list of one revision, parsed into sources. Same write-once
-- keying as `articles` and, deliberately, its own version column: sources come
-- out of the part of the page the article parser strips, so a parser fix has no
-- bearing on them and should not throw them away.
CREATE TABLE IF NOT EXISTS article_sources (
  lang            TEXT        NOT NULL,
  revid           BIGINT      NOT NULL,
  sources_version TEXT        NOT NULL,
  sources         JSONB       NOT NULL,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lang, revid, sources_version)
);

-- Comparison output, keyed by every participating revision id plus the engine
-- version. A steady-state article costs zero tokens on every request after the
-- first one.
CREATE TABLE IF NOT EXISTS comparisons (
  cache_key   TEXT        PRIMARY KEY,
  qid         TEXT        NOT NULL,
  result      JSONB       NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comparisons_qid_idx ON comparisons (qid);

-- Serves both the "recently cached" list on the landing page and the newest-first
-- tiebreak when several stored comparisons for one subject could answer: a row
-- keeps serving after the revision ids move on, so an edit on Wikipedia doesn't
-- force a re-read.
CREATE INDEX IF NOT EXISTS comparisons_computed_at_idx ON comparisons (computed_at DESC);

-- A claim's generated explanation, written the first time anyone hovers it and
-- served to everyone after. `usage` is the model's token usage for that one call.
CREATE TABLE IF NOT EXISTS explanations (
  cache_key  TEXT        NOT NULL,
  claim_id   TEXT        NOT NULL,
  text       TEXT        NOT NULL,
  model      TEXT        NOT NULL,
  usage      JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cache_key, claim_id)
);

-- Wikidata labels for the coverage diff. Cheap to refill, safe to truncate.
CREATE TABLE IF NOT EXISTS labels (
  qid   TEXT PRIMARY KEY,
  label TEXT NOT NULL
);

-- How many people have read a cached comparison. Defaulting to 0 rather than 1
-- keeps the counter meaning reads served from cache.
ALTER TABLE comparisons ADD COLUMN IF NOT EXISTS served_count INTEGER NOT NULL DEFAULT 0;
