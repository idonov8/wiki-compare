# wiki-compare

Reads the English, Hebrew and Arabic Wikipedia articles on one subject side by side and marks
where they disagree: contradicted facts, material one version leaves out, and the same fact
framed differently. Hover a mark to see the matching passages and why it was marked; select any
text to see where it sits in the other languages.

Live at [wikicompare.app](https://wikicompare.app). Free to use; if it helps you,
[buy me a coffee](https://ko-fi.com/berlinsessions).

## How it works

1. A subject is resolved to its Wikidata item, and each language's article is fetched and split
   into paragraphs and sentences (`lib/wikipedia.ts`, `lib/jev/segment.ts`).
2. TypeSafe's Jev matches every paragraph to the other articles and
   classifies every sentence as consistent, contradiction, framing or gap, then rates how much
   each difference matters (`lib/jev/`). Design, measurements and the gold set:
   [docs/jev-poc-design.md](docs/jev-poc-design.md).
3. Only the most important differences are drawn by default (`lib/salience.ts`).
4. Claude writes an explanation of a difference when a reader points at it, once per difference
   (`app/api/explain/`).
5. Results are cached by article revision (`lib/db.ts`). Reference lists are matched across
   languages without a model (`lib/sources.ts`).

Each comparison is computed once and served from the cache to everyone after. Spending on models
is capped per day (`DAILY_BUDGET_USD`, `lib/budget.ts`).

## Running it

```bash
npm install
cp .env.example .env.local     # DATABASE_URL, TYPESAFE_API_KEY, ANTHROPIC_API_KEY
npm run db:init
npm run dev
```

`/?title=demo:jev:palestinian-legislative-council` runs the engine on a recorded fixture, with no
Wikipedia fetch.

```bash
npm run check                    # offline checks, no model or database
npm run check:ui                 # rendering, against a running dev server
npm run jev:run -- <fixture>     # a real Jev run, with an HTML review page
```

`npm run subscribers` lists the people who signed up for project updates, each with their
unsubscribe link.

## License

The code is under the [PolyForm Noncommercial License 1.0.0](LICENSE.md): free to use, change and
share for any noncommercial purpose. For commercial use, get in touch. Wikipedia text and images,
including the recorded articles in `fixtures/`, are under
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) from their authors.

## Caveat

Comparisons are machine-generated and can be wrong or incomplete. Treat a marked difference as a
pointer to check the sources, not a finding. Every column links to the exact revision it shows.
