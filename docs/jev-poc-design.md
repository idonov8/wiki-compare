# Jev engine

The comparison treated as classification rather than generation, on TypeSafe's
Jev, across English, Hebrew and Arabic.

The original Claude engine read up to 8 sections, 2,500 characters each, and wrote
every finding as free text: summary, explanation and verbatim quotes. Jev cannot
write text at all, but answers typed questions cheaply and fast, so this engine
asks many small questions instead of one big one, reads the whole article, and
takes its highlights from the article itself instead of from quotes. Claude
(Sonnet) is kept for the one part that is writing: explaining a difference when
a reader points at it.

## Pipeline

```
two or three snapshots (en, he, ar)
  │
  ├─ 0. Segment (code)          paragraphs + sentences, exact slices of section text
  │
  │   for every ordered pair of languages (up to six):
  ├─ 1. Match (Jev)             each paragraph → a paragraph of the other article, or "none"
  │       "none" ─────────────► every sentence of it is a gap in that language
  ├─ 2. Classify (Jev)          each sentence vs its matched paragraph(s):
  │                               consistent | contradiction | framing | gap
  │                             + which sentence of the other article it corresponds to
  ├─ 3. Re-check gaps (Jev)     a sentence gap is matched again against the whole article,
  │                             and classified again if it finds a new home
  │
  ├─ 4. Merge (code)            gaps per sentence, naming every language they are missing
  │                             from; contradictions and framing joined wherever they share
  │                             a sentence, so one finding marks all three columns
  ├─ 5. Figures (code + Jev)    a "consistent" pair with differing numbers is kept as a
  │                             contradiction only if Jev says they are different values
  │                             for the same thing
  ├─ 6. Importance (Jev Score)  every claim rated 0 (minor detail) to 3 (central or contested);
  │                             a paragraph missing as a whole is rated once, as a whole
  └─ 7. Alignment (code)        for every sentence, its paragraph and sentence in each other
                                language, for the hover panel
```

Code: `lib/jev/` (`segment.ts`, `client.ts`, `match.ts`, `classify.ts`,
`pipeline.ts`), `lib/salience.ts` (what is drawn by default), `lib/explain.ts`
and `app/api/explain/route.ts` (explanations).

## Decisions, and why

**Units are slices, so highlights are exact by construction.** Paragraphs and
sentences are character ranges of `Section.text`; the sentence splitter is
`Intl.Segmenter`. A short line joins the paragraph before it, and a line ending in
a colon keeps its bullet list together. Long bullets stay separate points. Infobox
lines are their own units and are matched only against infobox lines. Claims carry
exact `refs`, so a sentence that appears in both the lead and the body is marked
where it was found.

**Text goes in the state once; options are bare IDs.** The layout of TypeSafe's
own semantic-find cookbook: the candidates are an ID-tagged document in the state
(`b3| [History] ...`) and the Choice options are `b0..bN` with no description.
Text in the options repeats it in every question; on Coffee that was about 2.3M
estimated input tokens against about 0.95M this way.

**Request sizes are planned, then corrected by Jev.** TypeSafe does not publish
its tokenizer, and the first real run was refused with `400 max_tokens_exceeded`
when Hebrew was estimated at two characters a token. The planner assumes one
Hebrew character a token, keeps batches to 32 questions and 40k estimated tokens,
and corrects its estimate from each response's `input_tokens` (real runs come in
at about 1.15x the estimate). A refused request is split in half and resent,
down to one question; a matching question too large on its own falls back to the
tournament, with smaller chunks each time.

**Every Choice is asked in both option orders and the two are averaged.**
jev-1.13 leans toward the first option. Averaging cancels the lean; on the PLC the
two orders agreed on 166 of 172 paragraph matches and 162 of 170 sentences.

**More than the top match is kept.** Candidates down to 15% probability, up to 3,
are all classified against: English often covers in one paragraph what Hebrew
splits over two, and the lead restates the body.

**Big pools run as a tournament.** A Choice takes at most 255 options and a
request at most 32k tokens for the state plus the longest question. A pool past
either is split into chunks; each nominates its two likeliest paragraphs, and each
unit gets a final round of its own over its best eight nominees.

**Figures are found in code and confirmed by Jev.** TypeSafe documents that Jev
reads numbers as text, so comparing them is code's job. But two sentences holding
different numbers are usually about different things; a fixed confidence let the
English quorum sentence (2006, 132, 74) "contradict" a Hebrew list item. So Jev
is asked whether the figures are different values for the same quantity, which is
a reading question, and its answer is the claim's confidence.

**Importance is a separate question from confidence.** A gap is cheap to be right
about and usually uninteresting: when one version is four times longer, nearly all
of it is missing from the other. Jev's Score question rates how much each
difference matters to a reader; routine dates come out near 0.5 and the
politically central material near 2.5 to 2.8.

**What is drawn by default is a budget, not a cut-off** (`lib/salience.ts`). On the
PLC, gaps rated 2 or more still covered 63% of the English text and 7% of the
Arabic, so no fixed importance works for both. Gaps share a budget of a quarter of
each article's text, spent on the most important first, a paragraph missing as a
whole counting as one unit. Contradictions and framing show unless Jev was unsure
or rated them trivial, and a contradiction Jev is at least 90% sure of shows even
when trivial. Everything else is one "show all" away.

**Explanations are written on demand and stored.** The panel asks
`/api/explain` for a claim only once the pointer rests on it. Sonnet (low effort,
server-side refusal fallbacks) gets the flagged sentences inside their paragraphs
and, for a gap, what each lacking version has nearest to it, so it can say when a
finding looks mistaken. The first explanation of a claim is stored in
`explanations` and served to everyone after. The route takes a comparison key and a
claim id, never text, so it cannot be used to send arbitrary prompts.

**Missing infobox fields are not gaps.** An infobox line with no counterpart is a
template difference, not a finding.

## Results on the fixtures (real runs)

| Fixture | Languages | Requests | Input tokens | Cost | Jev time |
|---|---|---|---|---|---|
| Palestinian Legislative Council | en he ar | 218 | 0.42M | 1.8¢ | 2.1s |
| Coffee | en he ar | 951 | 3.7M | 15.5¢ | 5.2s |
| Hadag Nahash | en he | 114 | 0.28M | 1.2¢ | 1.4s |
| Tamer Hosny | en ar | 138 | 0.33M | 1.4¢ | 1.6s |

On Coffee, 91% of the tokens are the comparison itself (six directions over a
long article), 9% importance and almost nothing the figure check. For comparison,
the Claude engine averaged 10.3¢ for 8 sections and 3.9¢ for a preview.

By default about a third of each article is highlighted (PLC: 35% en, 37% he,
44% ar; previously 87 to 93%).

## The gold set

From `palestinian-legislative-council`, all checked by hand against the parsed
text. `npm run jev:run` scores a run against it: 13 of 14 found.

| Kind | Difference | |
|---|---|---|
| contradiction | 2006 seats: he 76 Hamas / 43 Fatah, en 74 | missed: the Hebrew article contradicts itself (its own list says 74) and Jev matched the list |
| contradiction | 1996 Fatah seats: en 62, he 68 | found |
| contradiction | Speaker "since": en 18 February 2006, he 2009 | found |
| contradiction | Oslo II council size: ar 83, en/he 88 | found |
| framing | he "Judea and Samaria" for en "West Bank" | found |
| gap in he | Goldstone Mission; movement restrictions; detention of members | found |
| gap in en | 2018 constitutional court ruling (in ar too); postponed over East Jerusalem; district seat breakdown | found |
| gap in en and he | the laws the council passed; the council's speakers (ar) | found |
| must not flag | 132 seats, which all versions state | not flagged |

The gold set records differences that exist, not which matter most; several are
behind "show all" by the threshold.

## Trying it

- `npm run check:segment`: segmentation over every fixture, no network.
- `npm run check:jev`: the whole pipeline against a stub of the API that counts
  tokens more harshly than the planner and refuses oversized requests the way Jev
  does, including a run at an eighth of the real limits. Checks every run
  completes, every claim can be highlighted, refs, importance, the alignment and
  the threshold.
- `npm run jev:run -- <fixture>`: a real run (needs `TYPESAFE_API_KEY`). Prints
  claims, what the threshold shows, importance by kind, tokens by stage, and the
  gold score; writes `reports/jev/<fixture>.html` with every column, each
  paragraph's match and a "show all" toggle. `--from-json` re-renders the last run.
- In development, `/?title=demo:jev:<fixture>` runs the engine on a recorded
  fixture without Wikipedia, and stores the result when `DATABASE_URL` is set so
  the explain route can find it.

## Open questions

- Framing is the subtlest class and the one the site exists for; the PLC's
  "Palestinian Authority" against "State of Palestine" was found and rated 2.8,
  but recall on framing is untested beyond the gold set.
- A self-contradicting article (the 2006 seats) needs a check within one version,
  which the pairwise design does not do.
- Long articles in three languages cost 10 to 15¢; asking the pair question only
  for sentences that are not gaps would cut the comparison stage by about a quarter.
