# Jev engine: proof of concept

An alternative to the Claude comparison that treats the job as classification
rather than generation. English against Hebrew only, for now.

The Claude engine reads up to 8 sections, 2,500 characters each, and writes every
finding as free text: summary, explanation and verbatim quotes. Jev (TypeSafe AI)
cannot write text at all, but answers typed questions cheaply and fast, so this
engine asks many small questions instead of one big one, reads the whole article,
and takes its highlights from the article itself instead of from quotes.

## Pipeline

```
en, he snapshots
  │
  ├─ 0. Segment (code)        paragraphs + sentences, exact slices of section text
  │
  ├─ 1. Match (Jev)           each paragraph → a paragraph of the other article, or "none"
  │       "none" ───────────► the whole paragraph is a gap, fixed explanation
  │
  ├─ 2. Classify (Jev)        each sentence vs its matched paragraph(s):
  │                             consistent | contradiction | framing | gap
  │                           + which sentence of the other article it corresponds to
  │
  ├─ 3. Re-check gaps (Jev)   a sentence gap is matched again against the whole
  │                           article; if it finds a new home, it is classified again
  │
  ├─ 4. Number check (code)   a "consistent" pair whose figures differ becomes a
  │                           low-confidence contradiction
  │
  └─ 5. Merge (code)          en→he and he→en, deduplicated, as ordinary `Claim`s
```

Code: `lib/jev/` (`segment.ts`, `client.ts`, `match.ts`, `classify.ts`,
`pipeline.ts`). `runJevComparison` has the same contract as `runComparison`, so
the route, cache, streaming and columns take it unchanged.

## Decisions, and why

**Units are slices, so highlights are exact by construction.** Paragraphs and
sentences are character ranges of `Section.text`; the sentence splitter is
`Intl.Segmenter`. A short line joins the paragraph before it, and a line ending in
a colon keeps its bullet list together, so "The seats were divided as follows:"
and its items are one unit. Long bullets stay separate points. Infobox lines are
their own units and are matched only against infobox lines.

**Text goes in the state once; options are bare IDs.** This is the layout of
TypeSafe's own semantic-find cookbook: the candidate paragraphs (or sentences)
are an ID-tagged document in the state (`b3| [History] ...`), and the Choice
options are `b0..bN` with no description. The first version put the text in the
options, which repeats it in every question; on Coffee that was about 2.3M
estimated input tokens against about 0.95M now.

**Every Choice is asked in both option orders and the two are averaged.**
jev-1.13 leans toward the first option. Averaging cancels the lean, and whether
the two orders agreed is reported per answer, a free signal of how settled it is.

**More than the top match is kept.** Candidates down to 15% probability, up to 3,
are all classified against: English often covers in one paragraph what Hebrew
splits over two, and the lead restates the body.

**Big pools run as a tournament.** A Choice takes at most 255 options and a
request at most 32k tokens for the state plus the longest question. A pool past
either is split into chunks; each chunk nominates its two likeliest paragraphs,
and a final round chooses among the nominees. "none" is decided in the final
round only.

**Figures are checked in code.** TypeSafe documents that Jev reads numbers and
dates as text. So Jev decides which sentences correspond, and `extractNumbers`
decides whether their figures differ. Hebrew-calendar and Hijri dates are not
handled.

**Confidence is shown, not hidden.** Each claim carries `confidence` (0 to 1).
The columns draw the mark's band at 25% to 100% strength accordingly, and the
claim card prints it. Flags under 35% are dropped (with four options, 25% is
chance).

**Missing infobox fields are not gaps.** An infobox line with no counterpart is a
template difference, not a finding.

## Trying it

- `npm run check:segment`: segmentation over every fixture, no network.
- `npm run check:jev`: the whole pipeline against a stub of the API, checking
  that every request fits the API's limits and every claim can be highlighted.
- `npm run jev:run -- <fixture>`: a real run (needs `TYPESAFE_API_KEY`). Prints
  claims, cost, option-order agreement and, for
  `palestinian-legislative-council`, a score against eleven hand-verified
  differences. Writes `reports/jev/<fixture>.html`, both articles side by side
  with each paragraph's match and every mark shaded by confidence. Add
  `--from-json` to re-render the last run without calling the API.
- In the app: `/?title=...&engine=jev`. Always available in development; a
  deployment needs `JEV_ENABLED=1`. Results are cached under `jev-v1`, separate
  from the Claude engine's rows, and the engine is never reached from the paid
  POST path. Each run fires `jev_comparison_run` with counts, requests, tokens,
  cost and duration.

## The gold set

From `palestinian-legislative-council`, all checked by hand against the parsed
text:

| Kind | Difference |
|---|---|
| contradiction | 2006 seats: he 76 Hamas / 43 Fatah, en 74 |
| contradiction | 1996 Fatah seats: en 62, he 68 |
| contradiction | Speaker "since": en 18 February 2006, he 2009 |
| framing | he "Judea and Samaria" for en "West Bank" |
| gap in he | Goldstone Mission; movement restrictions; detention of members |
| gap in en | 2018 constitutional court ruling; postponed over East Jerusalem; district seat breakdown |
| must not flag | 132 seats, which both versions state |

Eleven items is small, and every one is known to be right. The real test is
reading the report and the app against the Claude engine's comparison of the
same article.

## Cost and volume (estimated, stub runs)

| Fixture | Requests | Est. input tokens | Est. cost |
|---|---|---|---|
| Coffee (en 103 / he 78 paragraphs) | ~205 | ~0.95M | ~4¢ |
| PLC | ~65 | ~0.18M | ~0.8¢ |
| Hadag Nahash | ~54 | ~0.17M | ~0.7¢ |

The estimate deliberately overcounts (3.5 characters a token for Latin text, 2 for
Hebrew), and assumes the whole request body is billed. A real run reports actual
usage. For comparison, a Claude full run averages 10.3¢ for 8 sections, and a
preview 3.9¢.

## Open questions

- Hebrew accuracy. TypeSafe says non-English is "handled but not equally well".
  The gold score and the order-agreement rate are the first measurements.
- Granularity. Sentence-level gaps may be too many to read; a "does this matter"
  Score may be needed to rank or filter them.
- Framing is the subtlest class and the one the site exists for. If Jev is weak
  there, framing candidates could be routed to Claude.
- Explanations are fixed per type. Rich text, generated on demand for claims a
  reader opens, is the next step once detection is trusted.
