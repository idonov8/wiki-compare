-- Parsed article text, keyed by revision id. Revision ids are immutable, so
-- rows here are written once and never updated or expired.
CREATE TABLE IF NOT EXISTS articles (
  lang       TEXT        NOT NULL,
  revid      BIGINT      NOT NULL,
  title      TEXT        NOT NULL,
  snapshot   JSONB       NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (lang, revid)
);

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

-- Wikidata labels for the coverage diff. Cheap to refill, safe to truncate.
CREATE TABLE IF NOT EXISTS labels (
  qid   TEXT PRIMARY KEY,
  label TEXT NOT NULL
);
