# Semantic diffing across languages powered by Jev 

https://github.com/user-attachments/assets/7c793d88-b3c4-4e9a-91fb-c60ed754191f

Live at demo with Wikipedia articles on [wikicompare.app](https://wikicompare.app) **for free!!** (actually I pay for it :')))
[buy my ai a coffee](https://ko-fi.com/berlinsessions) if you enjoy it. 



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
