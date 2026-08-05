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
- Rendering, including that highlights do not break at a direction boundary (`npm run check:ui`).

Not yet verified — needs `ANTHROPIC_API_KEY` and `DATABASE_URL`:

- `alignHeadings` and `diffGroups` in `lib/compare.ts`. No model call has been made.
- `verifySpans`. The model must return snippets character-for-character; the drop rate is logged
  on every run and is the number to watch. If most claims are dropped the prompt needs tightening,
  not the matcher loosening.
- Every database path: the schema, the caches, and the `?fresh=1` bypass.

## Setup

```bash
npm install
cp .env.example .env.local     # fill in DATABASE_URL and ANTHROPIC_API_KEY
npm run db:init                # applies db/schema.sql to Neon
npm run dev
```

`DATABASE_URL` is the **pooled** Neon connection string. `ANTHROPIC_API_KEY` is yours; it is only
ever read server-side in `lib/compare.ts` and never reaches the browser.

Deploying to Vercel: import the repo, set both variables in Project Settings → Environment
Variables, and run `npm run db:init` once locally against the same database.

## How a request works

```
title ──▶ Wikidata QID ──▶ en/he/ar titles
             │
             ▼
        3 revid lookups            ◀── tiny; decides both cache hits
             │
     ┌───────┴────────┐
     │ comparisons    │  key: qid:en{rev}.he{rev}.ar{rev}:promptVersion
     │ cache hit?     │──▶ yes: return, zero tokens
     └───────┬────────┘
             │ no
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

Wikipedia revision ids are immutable, so both caches are write-once and never expire. Keying
article text on `revid` alone means an edit to the Hebrew page doesn't invalidate the English
fetch. Keying the comparison on all three revids plus `PROMPT_VERSION` means a stable article
costs zero tokens on every request after the first.

Article snapshots are additionally keyed on `PARSER_VERSION`. Only the *input* is immutable, not
our reading of it: keyed on revision id alone, a parser fix stays invisible to every article
already cached, because the revision hasn't changed. `?fresh=1` recomputes and overwrites one
comparison, so iterating on the prompt never means deleting rows.

Before any model call, `lib/deterministic.ts` does the work that doesn't need one: linked-concept
coverage is pure set arithmetic over Wikidata ids, and numeric divergence — with Arabic-Indic
digits normalised, so ١٣٢ and 132 compare equal — flags which sections are worth reading. Only
those sections reach the model.

Coverage is computed over links read off the cleaned article tree, not the API's link list. The
API lists every link on the rendered page, including navboxes, authority-control templates and
citation footnotes — so using it made the coverage panel disagree with the columns above it and
report "WorldCat" as a concept one version uniquely covers.

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

A fixed rail down the right edge (`components/DiffNav.tsx`) plots every mark against the length of
the page and tracks the slice currently on screen, so the differences are visible at a glance while
scrolling; the arrow control steps through them in reading order. It reads only marks that have
client rects, so a difference folded inside the collapsed Key facts block is skipped until the
block is opened, and a `toggle` listener re-plots the rail when it is.

Each column leads with the article's lead photo (`extractLeadImage` in `lib/wikipedia.ts`, pulled
from the infobox before the chrome is stripped, preferring a `.jpg` photograph over the logos and
coats of arms an infobox also carries) and then the Key facts block, which is the infobox flattened
to `Label: value` lines. Key facts is a `<details>` folded shut by default, so the lead paragraph
is the first prose in each column, and each line is rendered as an infobox row — bold label beside
value — except a row that carries a difference, which stays one highlightable unit (a claim can
span the label and the value, as the 2006 seat split does).

The open article lives in the URL (`/?title=<title>&lang=<source>`), so a comparison is linkable
and the browser's back button walks the history; `Compare` reads it on load and on `popstate` and
pushes a new entry when the box is submitted or a link is followed. Wikipedia-internal links
survive parsing as character ranges into each section's text (`extractLinks`, located by finding
each anchor's visible label in the already-normalised text) and are re-pointed at our own
comparison of the linked article, in that column's language — so following one from the Arabic
column compares the Arabic concept across all three. `components/Highlighted.tsx` splits each
section at every claim and link boundary and merges neighbouring runs, so a highlight and a link
can overlap without either being lost.

## Layout

```
app/api/compare/route.ts   orchestration and cache checks
lib/wikipedia.ts           MediaWiki + Wikidata fetching, HTML → sections
lib/deterministic.ts       zero-token coverage diff and section screening
lib/compare.ts             heading alignment + claim diff
lib/db.ts                  Neon cache layer
db/schema.sql              three tables: articles, comparisons, labels
components/Compare.tsx     columns, toggles, hover card
components/Highlighted.tsx span location and marking
components/DiffNav.tsx      right-edge rail + jump-to-difference controls
fixtures/                  recorded API responses + loader
scripts/                   fixture recorder and the check suites
```

## Testing

```bash
npm run check              # parser + deterministic, no network, no model, no database
npm run check:ui           # rendering, needs `npm run dev` in another shell
npm run fixtures:save "Article title"   # record a new fixture
npm run fixtures:refresh                # re-record the existing ones
```

Fixtures store raw `action=parse` HTML rather than parsed sections — the parser is the part most
worth testing, so a fixture holding its output would assert nothing. Four are recorded: the
Palestinian Legislative Council case with known answers, Coffee as a low-stakes control, and
Hadag Nahash (en+he) and Tamer Hosny (ar+en) for the two-language path.

In development, `?title=demo:<fixture-slug>` renders a recorded fixture through the real
components without a model call or a database — useful for working on the rendering layer. Its
claims are located in the real text so the spans are exact, but they are hand-written, not model
output. The route is inert in production.

## Caveats worth knowing

Comparisons are generated by a language model and can be wrong or incomplete — treat a marked
difference as a pointer to check the sources, not a finding. On contested subjects the framing
category is the most subjective of the three; the prompt asks for neutral description rather than
adjudication, but that instruction is not a guarantee. Every column links to the exact revision it
rendered, so anything shown here can be checked against the article itself.
