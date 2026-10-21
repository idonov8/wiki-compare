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

-- Serves both the "recently cached" list on the landing page and the newest-first
-- tiebreak when several stored comparisons for one subject could answer: a row
-- keeps serving after the revision ids move on, so an edit on Wikipedia doesn't
-- force a re-read. Only a paid refresh replaces it.
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

-- Better Auth's own tables — user, session, account, verification.
--
-- These used to live only in Better Auth's migrator, on the reasoning that two
-- tools issuing DDL for one table is how two descriptions of it start to
-- disagree. That reasoning cost more than it saved: setup was two commands, the
-- second was skippable, and skipping it left an app whose every sign-in attempt
-- 500s against tables that were never created. A schema that is one command
-- behind is not a safer schema, it is a broken one.
--
-- So the DDL below is transcribed from `npx @better-auth/cli generate`, which
-- reads lib/auth.ts and is still the source of truth: when that file's fields
-- change, re-run the generator and bring the diff here rather than hand-editing.
-- `auth:migrate` remains in package.json and remains compatible — it is just no
-- longer load-bearing, because IF NOT EXISTS means whichever runs first wins and
-- the other is a no-op instead of a conflict.
--
-- "user" is a reserved word and the columns are camelCase, so every identifier
-- here stays quoted; an unquoted "creditCents" folds to "creditcents" and stops
-- matching the column lib/credits.ts writes to.

CREATE TABLE IF NOT EXISTS "user" (
  "id"              TEXT        NOT NULL PRIMARY KEY,
  "name"            TEXT        NOT NULL,
  "email"           TEXT        NOT NULL UNIQUE,
  "emailVerified"   BOOLEAN     NOT NULL,
  "image"           TEXT,
  "createdAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Declared in lib/auth.ts as additionalFields with `input: false`. DEFAULT 0
  -- is ours, not the generator's: Better Auth applies its defaultValue in
  -- application code, which leaves any row inserted by SQL — a fixture, a
  -- backfill, a future provider that writes its own — with a NULL balance that
  -- lib/credits.ts would arithmetic into more NULL rather than into a number.
  "creditCents"     INTEGER     NOT NULL DEFAULT 0,
  "peakCreditCents" INTEGER     NOT NULL DEFAULT 0,
  "onboardingDone"  BOOLEAN     NOT NULL DEFAULT false
);

-- For databases whose user table was created by `auth:migrate` back when the
-- credit columns were not part of it. No-ops everywhere else.
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "creditCents"     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "peakCreditCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "onboardingDone"  BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "session" (
  "id"        TEXT        NOT NULL PRIMARY KEY,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "token"     TEXT        NOT NULL UNIQUE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMPTZ NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "userId"    TEXT        NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);

-- One row per way an account can prove it is itself: the magic-link identity,
-- and a row per OAuth provider once Google is configured. The token columns are
-- what a social sign-in fills and a magic link leaves null.
CREATE TABLE IF NOT EXISTS "account" (
  "id"                    TEXT        NOT NULL PRIMARY KEY,
  "accountId"             TEXT        NOT NULL,
  "providerId"            TEXT        NOT NULL,
  "userId"                TEXT        NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken"           TEXT,
  "refreshToken"          TEXT,
  "idToken"               TEXT,
  "accessTokenExpiresAt"  TIMESTAMPTZ,
  "refreshTokenExpiresAt" TIMESTAMPTZ,
  "scope"                 TEXT,
  "password"              TEXT,
  "createdAt"             TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"             TIMESTAMPTZ NOT NULL
);

-- Short-lived tokens: the magic link's own value lands here and is deleted on
-- use, which is why a row count of zero is the healthy steady state.
CREATE TABLE IF NOT EXISTS "verification" (
  "id"         TEXT        NOT NULL PRIMARY KEY,
  "identifier" TEXT        NOT NULL,
  "value"      TEXT        NOT NULL,
  "expiresAt"  TIMESTAMPTZ NOT NULL,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "session_userId_idx"          ON "session" ("userId");
CREATE INDEX IF NOT EXISTS "account_userId_idx"          ON "account" ("userId");
CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier");

-- Every attempt to donate, funded or not.
--
-- The unfunded rows are the point of the table rather than noise in it. Credit
-- is granted once per account, so a second attempt records granted_cents = 0 and
-- is still worth keeping: people reaching the payment page and going through
-- with it is the only evidence there is for whether this is worth continuing,
-- and a table that stores just the grants cannot answer that.
--
-- user_id is TEXT and carries no foreign key to Better Auth's user(id), on
-- purpose. The original reason was boot order between two migration tools, and
-- that reason is gone now that "user" is created above this line in the same
-- file. The remaining reason is the one that actually matters: this ledger is
-- append-only evidence about what happened, not a projection of who currently
-- exists. "user" deletes cascade to session and account by design; cascading
-- them to here would quietly rewrite the donation history every time somebody
-- closed an account, and the count of people who tried to pay is the one number
-- this table exists to keep. A dangling id is the correct outcome.
--
-- `coupon` is kept and no longer written: coupons land in coupon_redemptions
-- now, and this column still holds the codes typed in before they did.
CREATE TABLE IF NOT EXISTS donations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL, maintenance_cents INTEGER NOT NULL DEFAULT 0,
  monthly BOOLEAN NOT NULL DEFAULT false, coupon TEXT,
  granted_cents INTEGER NOT NULL, mock BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per coupon somebody has redeemed. Which codes exist and what they are
-- worth is policy, and lives in lib/coupons.ts; this is the record of fact.
--
-- UNIQUE (user_id, code) is the guard, not tidiness: redemption inserts against
-- it with ON CONFLICT DO NOTHING, so two tabs on one code are serialised by
-- Postgres and exactly one comes back with a row. A SELECT first would leave a
-- window between the question and the grant.
--
-- Same TEXT user_id with no foreign key as the ledgers below: append-only
-- evidence, and a closed account should not un-redeem its coupons.
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  granted_cents INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, code)
);

CREATE INDEX IF NOT EXISTS coupon_redemptions_user_idx ON coupon_redemptions (user_id);

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

-- Permission to send somebody a commercial message, and its withdrawal.
--
-- Section 30A of the Communications Law makes an advertisement anything sent to
-- promote a monetary expenditure, and requires prior consent given in writing
-- before one is sent. "We'll email you when payments open" and "we'll email
-- before each monthly charge" are both that. The statutory damages are NIS 1,000
-- per message with no proof of damage required, so the thing that matters here
-- is not holding a flag but being able to show, per message, that permission
-- existed when it was sent.
--
-- Which is why this is an append-only log of decisions rather than a boolean on
-- the user row. A boolean answers "may we write to them now"; only the log
-- answers "were we allowed to send the one we sent in March", which is the
-- question a claim actually asks. `granted = false` rows are withdrawals, and
-- they are kept for the same reason: proof of when the permission stopped is
-- worth as much as proof of when it started.
--
-- `source` records which surface asked, and `evidence` the exact words consented
-- to. Consent to a specific wording is what the section requires; a row saying
-- only "true" cannot show what was agreed to.
CREATE TABLE IF NOT EXISTS email_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  granted BOOLEAN NOT NULL,
  source TEXT NOT NULL,
  evidence TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The lookup is always "the newest decision for this account", never a scan.
CREATE INDEX IF NOT EXISTS email_consents_user_idx ON email_consents (user_id, created_at DESC);

-- Who paid for a cached comparison, and how many people have read it since.
-- Together they are what a donor is shown in return: not "you spent $2" but
-- "ten articles, read ninety times". Defaulting served_count to 0 rather than 1
-- keeps the counter meaning reads served from cache, which is the number that
-- makes the donation worth more than the one article that prompted it.
ALTER TABLE comparisons ADD COLUMN IF NOT EXISTS served_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comparisons ADD COLUMN IF NOT EXISTS funded_by TEXT;
