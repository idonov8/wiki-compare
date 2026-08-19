# wiki-compare

Reads the English, Hebrew and Arabic Wikipedia articles on one subject side by side and marks
where they disagree: contradicted facts, material one version omits, and the same fact framed
differently. Hover a mark to see what the difference is.

## Status

The fetching, parsing, deterministic and rendering layers have been run against live Wikipedia and
are covered by checks. **The model pass has still never executed** — no comparison has been
generated, and no row has ever been written to the database.

Verified:

- Parsing, against live `action=parse` output in all three languages (`npm run check:parser`).
- The zero-token coverage and screening pass (`npm run check:deterministic`).
- Rendering, including that highlights do not break at a direction boundary, and that the
  one-language-at-a-time phone layout keeps its switch and its swipe in step (`npm run check:ui`).

Not yet verified — needs `ANTHROPIC_API_KEY` and `DATABASE_URL`:

- `alignHeadings` and `diffGroups` in `lib/compare.ts`. No model call has been made.
- `verifySpans`. The model must return snippets character-for-character; the drop rate is logged
  on every run and is the number to watch. If most claims are dropped the prompt needs tightening,
  not the matcher loosening.
- Every database path: the schema, the caches, and the `?fresh=1` bypass.
- Everything money touches. Sign-in has never completed, no credit has been granted or spent, and
  no donation row exists. The debit statement is written to be safe under concurrency but that has
  not been demonstrated against a real database; the check worth running first is two simultaneous
  debits against a single article's worth of credit, which must leave the balance at zero rather
  than below it.
- The sign-up grant. The `create.before` hook sets `creditCents` on the row Better Auth inserts,
  which the adapter writes because `input: false` only closes the HTTP endpoints, not the
  adapter — but no account has actually been created against a database to prove it. The check
  worth running first is a fresh magic-link sign-up: the masthead should read $1.00 immediately,
  with the note beside it.
- That `creditCents` really is unreachable through Better Auth's own update endpoint. It is
  declared `input: false`, which should make it server-owned; the flag is one word long and the
  failure it prevents is anyone minting themselves credit, so it deserves a deliberate attempt to
  break it rather than trust.
- The preview boundary against a real article. `processedThrough` is derived from the section
  objects the model was actually shown, so it should line up with what the columns render, but no
  live article has been through it.

## Setup

```bash
npm install
cp .env.example .env.local     # fill in DATABASE_URL and ANTHROPIC_API_KEY
npm run db:init                # creates all ten tables
npm run dev
```

One migration command, and it creates everything: the caches, the labels, the donation and
spend ledgers, and Better Auth's `user`, `session`, `account` and `verification` — including
the two credit columns declared in `lib/auth.ts`. Every statement is `IF NOT EXISTS`, so
running it against a database that is already up to date is a no-op you can repeat freely.

It used to be two commands, with the auth tables owned by Better Auth's CLI on the reasoning
that two tools issuing DDL for one table is how two descriptions of it drift apart. The
reasoning was sound and the result was not: nothing enforced the second command, skipping it
left a database with five tables out of nine, and the app that came up on top of it failed
every sign-in with a 500 from inside the adapter. Setup that can be half-completed eventually
is. The DDL now lives in `db/schema.sql`, transcribed from `npx @better-auth/cli generate` —
still the source of truth, so when the fields in `lib/auth.ts` change, re-run the generator
and bring the diff across rather than hand-editing. `npm run auth:migrate` still works and is
still compatible; it is simply no longer something you have to remember.

`DATABASE_URL` is the **pooled** Neon connection string. `ANTHROPIC_API_KEY` is yours; it is only
ever read server-side in `lib/compare.ts` and never reaches the browser. `BETTER_AUTH_SECRET`
signs sessions. `RESEND_API_KEY` sends the sign-in links and is optional outside production —
without it the link is logged to the server console, which is all a local sign-in needs. That
branch keys on `VERCEL_ENV`, not `NODE_ENV`: Vercel builds previews with `NODE_ENV=production`,
so keying on `NODE_ENV` made every preview deployment throw on every sign-in attempt.

### Signing in with Google

Optional, and off unless configured. `lib/auth.ts` registers the provider only when both
`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set, and `components/SignIn.tsx` shows the
button only when `NEXT_PUBLIC_GOOGLE_ENABLED="true"`. Set all three together or none of them —
lib/auth.ts compares them at startup and warns when they disagree, because a Google button
that dead-ends and a configured provider nobody is offered are both silent failures.

In Google Cloud Console: **APIs & Services → Credentials → Create OAuth client ID → Web
application**. The authorised redirect URI must be exactly:

```
<origin>/api/auth/callback/google
```

so `http://localhost:3000/api/auth/callback/google` for local development, and the same path
on each deployed origin. Google matches this string exactly — a trailing slash or the wrong
port is the whole of most `redirect_uri_mismatch` errors. Preview deployments get a fresh
hostname per branch, so either register the ones you use or let previews sign in by email link
only, which they can always do.

Deploying to Vercel: import the repo, set the variables in Project Settings → Environment
Variables, and run `npm run db:init` once locally against the same database.

## Picking the article first

A comparison costs tokens and about a minute, and all of it is wasted if the subject was wrong —
"Coffee" the drink, the film and the town are three different Wikidata items. So the subject is
picked from search results rather than guessed from the box, and the choice starts everything at
once:

```
query ──▶ /api/search   pasted URL? one exact hit. otherwise search results with descriptions
   │                    (searched in the script's own edition: Hebrew query → he.wikipedia)
   ▼
choice ─┬▶ /api/articles  sitelinks + all three revisions. ~1s, no model, no tokens
        │                 → the columns, on screen while the rest runs
        └▶ /api/compare   the run below. reads the cache the request above just warmed
```

The two requests are fired together and the article is what fills the wait: the reader sees the
page they picked seconds in, rather than confirming it in a dialogue first.

Any Wikipedia edition can be pasted, not only the three compared: the QID lookup only needs one
wiki that has the page, so the French URL of an article is a valid way in.

The articles stay on screen for the whole comparison — the wait is spent reading the article rather
than a spinner. Arbitrary phrases in it drift in and out in the three difference colours while the
model reads: they say the text is being worked over, and are distinguishable from findings by having
no rule under the band, no hover card and no tick on the rail. The globe sits in a small panel at
the bottom centre with its stage text below it, click-through, so it never covers the columns.

## How a request works

```
title ──▶ Wikidata QID ──▶ en/he/ar titles
             │
             ▼
        3 revid lookups            ◀── tiny; decides both cache hits
             │
     ┌───────┴────────┐
     │ comparisons    │  key: qid:en{rev}.he{rev}.ar{rev}:promptVersion
     │ cache hit?     │──▶ exact key:      return, zero tokens
     │                │──▶ same subject,   return, zero tokens, flagged `cached`
     └───────┬────────┘    revids moved,
             │ no           under 3 days old
             ▼
        articles cache (key: lang+revid) ──▶ miss: parse + resolve link QIDs
             │
             ▼
     deterministic pass    ◀── coverage diff, digit normalisation, divergence scoring
             │                 costs no tokens; also picks which sections the model sees
             ▼
     align headings (Haiku)  ◀── heading strings only, never bodies
             │
             ▼
     claim diff (Sonnet)     ◀── top ~8 section groups, 3 per call, cached system prompt
             │
             ▼
     verify spans ──▶ store ──▶ respond
```

### Why it stays cheap

Wikipedia revision ids are immutable, so both caches are write-once. Keying article text on
`revid` alone means an edit to the Hebrew page doesn't invalidate the English fetch. Keying the
comparison on all three revids plus `PROMPT_VERSION` means a stable article costs zero tokens on
every request after the first.

Article snapshots are additionally keyed on `PARSER_VERSION`. Only the *input* is immutable, not
our reading of it: keyed on revision id alone, a parser fix stays invisible to every article
already cached, because the revision hasn't changed. `?fresh=1` recomputes and overwrites one
comparison, so iterating on the prompt never means deleting rows.

Writes stay exact; reads are looser. Keying reads on revision ids too was correct and far too
eager — a Wikipedia article of any prominence is edited several times a day, most of those edits
touching a category or a citation, and every one of them missed the cache and bought three article
fetches, a parse and a model run. So a stored comparison keeps answering for `CACHE_WINDOW_DAYS`
(3) after the revisions it was computed from have moved on. Nothing is overwritten to make that
work: the key still records exactly which revisions an answer describes, which is how a request
reusing one across an edit knows it is serving something older than live and can say so, rather
than presenting stale text as current. An exact key match is preferred whatever its age, and is
never flagged — it is by definition a description of the live revisions.

The window forgives revision ids and nothing else. A row computed under a different
`PROMPT_VERSION` or `PARSER_VERSION` is never reused for revisions it wasn't keyed to: those two
versions are the whole way the code says *our reading of this changed*, so letting them ride the
window would make each prompt fix invisible for three days on exactly the busy articles it was
written for.

Before any model call, `lib/deterministic.ts` does the work that doesn't need one: linked-concept
coverage is pure set arithmetic over Wikidata ids, and numeric divergence — with Arabic-Indic
digits normalised, so ١٣٢ and 132 compare equal — flags which sections are worth reading. Only
those sections reach the model.

Coverage is computed over links read off the cleaned article tree, not the API's link list. The
API lists every link on the rendered page, including navboxes, authority-control templates and
citation footnotes — so using it made the coverage panel disagree with the columns above it and
report "WorldCat" as a concept one version uniquely covers.

The panel groups its pills into one column per edition rather than one flat list, and each pill is
a jump: `extractLinks` stamps every `LinkSpan` with the Wikidata id its title resolved to, so a
click can find the one span in that edition's own column that is the pill's evidence, scroll to it
and flash it — the same ring `DiffNav`'s jump-to uses. A concept linked only from the infobox has
no such span (the key-facts block flattens its links to plain text) and the search gives up rather
than spinning; everywhere else, following a coverage gap means never having to read a whole column
to find the sentence it named.

### Why infoboxes survive

`stripChrome` removes what wraps the prose, but the infobox is extracted first, into a `(key facts)`
section. It's chrome by layout and content by substance: on the Palestinian Legislative Council
article the 2006 seat split — Hamas 74, Fatah 45 — appears in the English and Arabic infoboxes and
in neither article's running text. Discarding it made the clearest contradiction on the page
invisible in two of the three languages.

### Why spans, not offsets

The model returns the verbatim text it's pointing at, and the client finds it with `indexOf`.
Character offsets from a model are unreliable in general and worse across bidirectional text,
where the visual and logical order of a string differ. A claim whose span can't be found is
dropped rather than displayed in the wrong place.

## Who pays, and what that buys

Reading anything already compared is free and always will be, signed in or not. What costs money
is the act of comparing, and the arrangement is that whoever pays for it pays for everybody:
a funded comparison is written to the cache like any other, so the next person to open that
article gets it for nothing, and never finds out it was bought.

That makes the free tier affordable rather than merely generous. An uncached article is read as
far as the lead, the key facts and about seven paragraphs of the English version — sections whole,
since that is the smallest thing the fade can land on, and at most two of them — and the columns
fade out below that under a bar inviting somebody to fund the rest. A few cents of tokens per
article, not per visitor, because the preview is cached and shared exactly like a full run. The boundary is a
prefix of the article rather than the most divergent sections of it: `screenGroups` picks the
eight groups most likely to disagree and they are scattered through the page, which is right for
a full run and useless for a fade, since a fade only reads as a boundary if everything above it
was actually read. `previewGroups` in `lib/deterministic.ts` is the prefix version, and
`screenGroups` is untouched.

A preview and a full run of the same revisions are separate rows. Sharing a cache key would mean
whichever ran first won permanently — the preview would keep satisfying the cache and the funded
run would have nowhere to be stored, so somebody would pay for a comparison nobody could ever be
served. `getCachedComparison` prefers a full run over a preview even when the preview is the
exact-revision one and the full run is riding the freshness window: a preview read four sections
and stopped, and being pedantic about revision ids that have probably only moved by a citation is
not worth fading out most of the page for. Either way the reader is told, because an answer older
than live still carries the `cached` badge.

Costs are reported in money rather than tokens. `usage.byModel` records the two models
separately, which is what makes that possible at all: heading alignment runs on Haiku and the
claim diff on Sonnet at three times the price, so one summed total is wrong at either rate.
`costUsd` is computed once by the run that spent it and stored with it, so a comparison from
three weeks ago keeps reporting its own bill instead of being re-priced by today's rate card.

Accounts are Better Auth, by magic link. It owns identity; we own the money. The balance lives on
its user record as `creditCents`, declared with `input: false` so it cannot be set through Better
Auth's own sign-up or update endpoints — without that flag anyone can mint themselves credit with
a `curl`. Balance changes go through one statement in `lib/credits.ts` with the affordability test
in the `WHERE` clause, rather than through the ORM, because a read-modify-write lets two tabs
spend the same twenty cents.

A new account is created holding `SIGNUP_GRANT_CENTS` — $1.00, which is five articles. It is
written by a `databaseHooks.user.create.before` hook, into the same `INSERT` that creates the row
rather than by an `UPDATE` just after it, so there is no moment where a fresh account can be asked
to top up. That grant is what the whole flow is arranged around: the masthead asks a signed-out
reader to log in rather than to donate, the gate at the end of a preview does the same, and the
payment page is reached only by somebody who has actually run out. Signed in with credit, the gate
says "Donate this article" and names what pressing it spends and who gets it; the thanks appear on
the press, for nine seconds, because the run they paid for takes about a minute and a thank-you at
the end of it would be thanking somebody for waiting. `/api/me` reports `newcomer` — this balance
is still the sign-up grant, untouched — which is what raises the note beside the meter explaining
where the credit came from.

The funded run answers in the same NDJSON stream the free one does, so that minute is spent
watching the article being read rather than a disabled button. Nothing on the page moves on the
press — a donation can still be refused, and blanking the article optimistically would flash it
away for a request that never started. The handover happens on the first line the server sends:
the gate goes when the `scope` line says the read is now `full`, and the differences replace the
preview's as they are found. The split between the two response shapes is the debit. Everything up
to and including it answers with a status code, because not a byte has been written yet — "not
enough credit" is a 402, not a 200 carrying bad news. Everything after it is a line in the stream,
because by then the status is long spent, and a run that fails there emits an `error` line once
the credit has been handed back.

Payment is a mock. The pay button records the amount, the running-costs contribution and whether
it was meant to repeat monthly, then admits it cannot take the money and grants $5 anyway. The row
it writes is the entire point: the count of people who tried to give money to something that could
not take it is the only evidence that any of this is worth building properly. The grant happens
once per account; a second attempt is still recorded, and answered with a promise to email when
payments work, which is a promise we can keep because signing in was a magic link.

Coupons are not a mock. `WELCOME3` is $3 of real credit, and it arrives in two steps: the small
Check button beside the field asks whether a code is real and still yours (`GET /api/coupon`,
which changes nothing), and the pay button is what actually redeems it (`POST /api/coupon`).
Checking early is the point — finding out whether a code works no longer costs a donation you may
not want to make, and a typo comes back as one line under the field instead of as a thank-you
screen for something else — but committing still belongs on the button that commits.

`WELCOME3` is also time-limited, and the limit is real on both sides: `COUPON_ENDS` in
`lib/coupons.ts` names the last day it works, `/api/coupon` answers 410 with that date once it has
passed, and `components/CouponBanner.tsx` — the strip across the top of every page offering the
code, with the reason the credit is being handed out at all — prints the same deadline and takes
itself down when it arrives. The strip renders only after mount, because whether it belongs on
screen depends on today's date and on a dismissal kept in `localStorage`, neither of which the
server knows.

A checked code is a discount rather than a top-up beside the order, which is what makes the
summary add up. It becomes the order and then pays for it: processing is set to the $3 the code
covers, the running-costs line to nothing, and the coupon lands in the summary as −$3.00, so the
total reads $0.00 and the estimate reads 15 articles. The button says "Get $3.00 of credit", and
pressing it redeems and returns to the reading — with nothing to pay there is no payment to
attempt, and an unpaid attempt in `donations` would dilute the one number that table exists to
answer. Raise the amount and the $3 still comes off whatever you chose; the button charges the
remainder and does both.

The check is deliberately not authoritative. Between it and the redemption the same account can
spend the code in another tab, so `UNIQUE (user_id, code)` and the `ON CONFLICT DO NOTHING` insert
stay the only thing that decides — the same race, and the same answer, as the balance itself.
Which codes exist and what they are worth is a table in `lib/coupons.ts`, because that is policy
and belongs somewhere a reviewer sees it change; who has redeemed what is `coupon_redemptions`,
because that is a fact.

## Design notes

Highlights are filled bands in the difference's colour, with a darker rule under each so the type
reads without relying on the fill alone. A background block across mixed LTR/RTL runs is what
breaks up badly at direction boundaries — so the mark carries no inline padding and uses
`box-decoration-break: clone`, which keeps the fill continuous across the fragments a span splits
into where direction flips (`npm run check:ui` asserts there is no gap). Each column carries its
own `dir`, so Hebrew and Arabic run right-to-left independently of the page, and the arrow in each
column header shows which way that column reads. Each column is set on a white page in Wikipedia's
own idiom — a sans body, a serif heading with a rule under it, blue links, the article's title on
top — with one matching family per script (Noto Sans / Noto Serif and their Hebrew and Arabic
cuts) so the columns read as siblings rather than three unrelated documents.

The controls strip opens with a bar chart of how long each edition is (`components/LangBars.tsx`),
sorted longest first. It replaced three plain `EN`/`HE`/`AR` boxes that said only whether a column
was showing — which left the single most useful fact about a set of Wikipedia articles nowhere on
the page. They are unevenly written, routinely by five or ten times, and that unevenness is the
thing this site exists to point at. Chart and control are one object rather than a chart set
beside one: a bar filled with ink means that edition is on screen, a hollow bar of the same height
means it exists and is not, and pressing either changes which. A hidden edition keeps its bar,
because how long the version you are not reading is remains the only reason to bring it back. The
count is words rather than characters — Hebrew and Arabic drop the vowels English writes out, which
understates them by about a third before any real difference in coverage is measured.

Below the width where three columns stop fitting side by side, the comparison becomes one
language at a time. It used to stack the three, which turned a comparison into three articles
read one after another — by the time the Arabic version of a passage was on screen the English
one was thousands of pixels above it, and comparing them meant remembering rather than looking.
So a phone shows one column, and moves between them two ways: a floating pill at the bottom of
the viewport naming each edition in its own script, and a horizontal swipe across the article.
They are one state, not two — `LangSwitch` renders the language the swipe moves, so the control
can never disagree with what is on screen — and the incoming column slides in from the side it
was pulled in from, so a flick moves something visible rather than swapping the page. Scroll
position is deliberately kept across the change: the reader was part-way down an article and is
still part-way down the same article, in another language.

The switch floats rather than joining the strip's own language control because the strip is at
the top of a page that is read from the middle of it — the wish to see this passage in another
language arrives while reading that passage, and the control has to be under the thumb at that
moment. The chart stays at the top of the page there rather than being dropped, because how long
the two editions you are not reading are is a question only it can answer on a screen showing one
column — what a filled bar means simply narrows to fit, from "these editions sit beside each
other" to "this is the one being read". Pressing a bar there moves the same state the pill and the
swipe move, so all three can never disagree. The legend moves into the space to the chart's right
there and stacks into a column, which is what a key to a chart looks like anyway and takes the
strip from three lines to two — set as a row it wraps into a ragged block, and the line that costs
is a line of the article.
`useSwipe` reads the gesture without preventing anything, and takes only drags that are clearly
flatter than they are long — a page of Wikipedia is read by dragging it up and down, and a
gesture that stole a scroll halfway through would cost far more than the swipe is worth.

A fixed rail down the right edge (`components/DiffNav.tsx`) plots every mark against the length of
the page and tracks the slice currently on screen, so the differences are visible at a glance while
scrolling; the arrow control steps through them in reading order — lifted clear of the language
switch on a narrow screen, where the rail itself also stops taking clicks, since it runs down
the edge a thumb swipes from. It reads only marks that have
client rects, so a difference folded inside the collapsed Key facts block is skipped until the
block is opened, and a `toggle` listener re-plots the rail when it is.

Each column leads with the article's lead photo (`extractLeadImage` in `lib/wikipedia.ts`, pulled
from the infobox before the chrome is stripped, preferring a `.jpg` photograph over the logos and
coats of arms an infobox also carries) and then the Key facts block, which is the infobox flattened
to `Label: value` lines. Key facts is a `<details>` folded shut by default, so the lead paragraph
is the first prose in each column, and each line is rendered as an infobox row — bold label beside
value — except a row that carries a difference, which stays one highlightable unit (a claim can
span the label and the value, as the 2006 seat split does).

Before any search, the landing page lists what is already cached, newest first and one row per
subject — the cheapest articles in the system to open are the ones somebody already opened. A row
goes straight to the comparison rather than through the picker above: the picker exists to settle
which Wikidata item a typed phrase meant, and a cached row is already a settled one. It carries no
heading of its own: ruled rows of article titles beside their language sets are legible as a
history without being labelled one, and the hand-picked suggestions underneath it are only worth
the space while the list is empty. Each row sets its own `dir`, so a Hebrew or Arabic title
orders its characters correctly, but titles stay left-aligned regardless — the list is a
left-to-right piece of interface whichever script a title happens to be in, and letting alignment
resolve per row left the RTL titles floating mid-row while the English ones sat at the margin.
Each row carries two marks where the cached-at time used to be: a bar per edition over its own
`EN`/`HE`/`AR` code, scaled within that row rather than across the ledger so the fact it shows is
how lopsided one subject's versions are, and one line divided in proportion between the three inks
for the kinds of difference the run found. An edition the subject does not have draws a faint stub
under a code in the same wash, which is a different fact from a very short article. A preview row
prints the word `Preview` in the line's place instead: a preview's tallies come from the opening
section, and a proportion drawn from a fraction of one version would read as the shape of the whole
disagreement. That word also retired the `full`/`preview` badge that used to sit at the end of every
row — a coloured line and a word are already the difference between the two, and the badge was a
third column repeating it. Both marks stand on one hairline axis and name their exact figures on
hover; the cached-at time is still in the row's label, where a screen reader gets it.
`/api/recent` projects the titles, language sets, word counts and claim tallies out in SQL rather
than in TypeScript, because `result` holds every article's full section text and selecting the
column to reduce it in the client would pull megabytes over the wire to render a dozen rows. It
also never fails the caller: an unreachable or absent database leaves the landing page one section
shorter rather than showing an error for something nobody asked for.

The `cached` badge on the meta line appears only when the served comparison and Wikipedia have
actually diverged — an exact-revision hit is cached too, but it describes the live text, so
badging it would cry wolf on the ordinary case. Hovering or focusing it names which languages were
edited since, and when the answer expires. Its tooltip is plain CSS rather than the claim card's
measured placement: there is one of these and it is anchored to the top of the page, so it never
needs to dodge the viewport edge.

The open article lives in the URL (`/?title=<title>&lang=<source>`), so a comparison is linkable
and the browser's back button walks the history; `Compare` reads it on load and on `popstate` and
pushes a new entry when a result is chosen or a link is followed. Wikipedia-internal links
survive parsing as character ranges into each section's text (`extractLinks`, located by finding
each anchor's visible label in the already-normalised text) and are re-pointed at our own
comparison of the linked article, in that column's language — so following one from the Arabic
column compares the Arabic concept across all three. `components/Highlighted.tsx` splits each
section at every claim and link boundary and merges neighbouring runs, so a highlight and a link
can overlap without either being lost.

## Layout

```
app/api/compare/route.ts   GET: cache, or a free preview. POST: debits a credit, reads it all
                           both stream NDJSON under ?stream=1; `done` is the last line either way
app/api/recent/route.ts    the recently cached list, for the landing page
app/api/auth/[...all]/     Better Auth: sign-in, callback, session
app/api/me/route.ts        balance, and what this account's donations have been read
app/api/donate/route.ts    the mock payment, and the ledger row that is its real output
app/api/coupon/route.ts    redeeming a code, for credit that is not a mock
lib/coupons.ts             which codes exist and what each one is worth
app/donate/page.tsx        the payment page that cannot take a payment
app/login/page.tsx         where the masthead and the gate send a signed-out reader
lib/auth.ts                Better Auth setup; credits declared server-owned
lib/credits.ts             debit, grant and the ledger, in single statements
lib/pricing.ts             tokens to dollars, and dollars to articles
lib/analytics.ts           PostHog, and a no-op without a key
lib/wikipedia.ts           MediaWiki + Wikidata fetching, search, URL parsing, HTML → sections
lib/articles.ts            sitelinks + revisions + cached snapshots, shared by both routes
lib/ghost.ts               where the drifting marks go while a comparison runs
lib/deterministic.ts       zero-token coverage diff and section screening
lib/compare.ts             heading alignment + claim diff
lib/db.ts                  Neon cache layer
db/schema.sql              all ten tables, ours and Better Auth's, every one idempotent
components/Compare.tsx     search → choose → compare, hover card
components/SignIn.tsx      the sign-in screen: Google, or a link by email
components/LogIn.tsx       that screen as a page, with the way back in `?next=`
components/PreviewGate.tsx the seam between what was read and what wasn't
components/ThankYou.tsx    nine seconds of thanks, raised when credit is spent
components/CreditBar.tsx   balance in the masthead, the welcome note, the thank-you on hover
components/Donate.tsx      amounts, running costs, monthly, the Redeem button, and the reveal
components/Columns.tsx     the articles side by side, with or without a comparison
components/Highlighted.tsx span location and marking
components/DiffNav.tsx     right-edge rail + jump-to-difference controls
components/LangSwitch.tsx  the floating language pill, where one column is all that fits
components/LangBars.tsx    how long each edition is, and which of them are on screen
components/useSwipe.ts     the flick across the article that moves the same state
components/useNarrow.ts    whether three columns fit, as the `cols` breakpoint in JS
app/api/search/route.ts    candidate articles for a query, or a pasted URL
app/api/articles/route.ts  the articles alone, ahead of the comparison
fixtures/                  recorded API responses + loader
scripts/                   fixture recorder and the check suites
```

## Testing

```bash
npm run check              # input + parser + deterministic, no model, no database
npm run check:input        # URL parsing, search language, drifting-mark placement (no network)
npm run check:ui           # rendering, needs `npm run dev` in another shell
npm run fixtures:save "Article title"   # record a new fixture
npm run fixtures:refresh                # re-record the existing ones
```

Fixtures store raw `action=parse` HTML rather than parsed sections — the parser is the part most
worth testing, so a fixture holding its output would assert nothing. Four are recorded: the
Palestinian Legislative Council case with known answers, Coffee as a low-stakes control, and
Hadag Nahash (en+he) and Tamer Hosny (ar+en) for the two-language path.

In development, searching for `demo:<fixture-slug>` (or `?title=demo:<slug>` on either route)
renders a recorded fixture through the real components, skipping search, without
a model call or a database — useful for working on the rendering layer. Its
claims are located in the real text so the spans are exact, but they are hand-written, not model
output. The route is inert in production.

## Caveats worth knowing

Comparisons are generated by a language model and can be wrong or incomplete — treat a marked
difference as a pointer to check the sources, not a finding. On contested subjects the framing
category is the most subjective of the three; the prompt asks for neutral description rather than
adjudication, but that instruction is not a guarantee. Every column links to the exact revision it
rendered, so anything shown here can be checked against the article itself.
