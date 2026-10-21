export const LANGS = ["en", "he", "ar"] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_META: Record<Lang, { label: string; native: string; dir: "ltr" | "rtl" }> = {
  en: { label: "English", native: "English", dir: "ltr" },
  he: { label: "Hebrew", native: "עברית", dir: "rtl" },
  ar: { label: "Arabic", native: "العربية", dir: "rtl" },
};

/** Synthetic headings. The lead has none of its own, and the key-facts block is
 *  assembled from the infobox rather than lifted from a heading in the article. */
export const LEAD_HEADING = "(lead)";
export const KEY_FACTS_HEADING = "(key facts)";

export type ClaimType = "contradiction" | "unique" | "framing";

/** One cross-language difference. `spans` holds verbatim snippets so the client
 *  can locate them by string search — model-reported character offsets are not
 *  reliable, especially across bidirectional text. */
export interface Claim {
  id: string;
  type: ClaimType;
  summary: string;
  explanation: string;
  spans: Partial<Record<Lang, string>>;
  /** How sure the engine was, 0 to 1. Only the Jev engine reports one. */
  confidence?: number;
  /** How much the difference matters to a reader, 0 (minor detail) to 3
   *  (central or contested). Jev's expected score; see `isSalient`. */
  importance?: number;
  /** For a gap: the languages whose articles lack it. */
  missingFrom?: Lang[];
  /** Exactly where each span sits, where `spans` can only be searched for. */
  refs?: Partial<Record<Lang, TextRef>>;
  /** Gaps of one paragraph missing as a whole share this, and are shown or
   *  hidden together. */
  group?: string;
}

/** A run of one section's text, as character offsets into `Section.text`. */
export interface TextRef {
  section: number;
  start: number;
  end: number;
}

/** Where a sentence's content sits in another language's article: the paragraph
 *  it was matched to and, when Jev could point at one, the sentence. */
export interface Counterpart {
  paragraph: TextRef;
  sentence?: TextRef;
  /** How sure the match was, 0 to 1. */
  p: number;
}

/** One sentence of one article and its counterpart in each other language;
 *  `null` where no paragraph of that language covers it. */
export interface AlignedSentence extends TextRef {
  /** The paragraph the sentence belongs to, for placing the hover panel. */
  paragraph: TextRef;
  to: Partial<Record<Lang, Counterpart | null>>;
}

export type Alignment = Partial<Record<Lang, AlignedSentence[]>>;

/** A Wikipedia-internal link, as a character range into a section's `text`.
 *  `title` is the linked article's title in that section's own language.
 *  `qid` is the linked article's Wikidata item, when it resolved to one — the
 *  same id a coverage gap is keyed on, so a gap pill can find the span of the
 *  concept it names. Unread for now: the coverage-panel jump that was going to
 *  use it is disabled in `Compare.tsx` pending a redesign. */
export interface LinkSpan {
  start: number;
  end: number;
  title: string;
  qid?: string;
}

export interface Section {
  heading: string;
  level: number;
  text: string;
  links?: LinkSpan[];
}

/**
 * Who made a photograph and on what terms, as its Wikimedia file page states.
 *
 * Not optional decoration: CC BY-SA is a permission conditional on naming the
 * author and the licence, so a photo shown without this is a photo shown
 * without permission. `lib/wikipedia.ts` drops any image it cannot resolve one
 * of these for, which is why the renderer can treat its presence as given.
 */
export interface ImageCredit {
  /** The author as the file page names them, tags stripped. Absent on the
   *  occasional file whose page states terms but no author. */
  artist?: string;
  /** Short licence name, as Wikimedia writes it: "CC BY-SA 4.0", "Public domain". */
  license: string;
  licenseUrl?: string;
  /** The file description page, which carries the full terms. */
  fileUrl: string;
}

export interface ArticleImage {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
  /** Canonical "File:…" title on Commons, which is what the credit is looked
   *  up by and what makes a cached snapshot re-checkable. */
  file: string;
  credit?: ImageCredit;
}

export interface ArticleSnapshot {
  lang: Lang;
  title: string;
  revid: number;
  url: string;
  sections: Section[];
  /** The article's lead photo, pulled from the infobox, shown under the title. */
  image?: ArticleImage;
  /** Wikidata QIDs of linked concepts, used for the zero-token coverage diff. */
  linkQids: string[];
}

/**
 * One footnote of one article, reduced to what it can be recognised by.
 *
 * Sources are read from the reference list the article parser strips, and are
 * never shown to a model: `keys` is the whole of the matching, and every one of
 * them is a string that reads the same in Hebrew, Arabic and English — a URL, a
 * DOI, an ISBN, or a title long enough not to be a coincidence.
 */
export interface Source {
  /** The citation as one line, as the article prints it. */
  text: string;
  /** The title the citation states, where it states one as a field rather than
   *  as prose. */
  title?: string;
  /** What pressing the entry opens: the source itself, not an archive of it. */
  url?: string;
  /** Host without `www.`, which is the shorthand a list of sources is scanned
   *  by — "haaretz.co.il" says more at a glance than the headline does. */
  domain?: string;
  /** Identity keys. Two footnotes are the same source when they share one. */
  keys: string[];
}

/**
 * A source as one language's list shows it.
 *
 * Which sources are shared is the whole point of the list, so it travels on
 * every entry rather than being re-derived by whoever renders it. The keys are
 * dropped on the way out: they are how the matching was done, not something a
 * reader or the renderer has any use for, and a long article carries a couple
 * of hundred entries' worth of them.
 */
export interface SourceCitation extends Omit<Source, "keys"> {
  /** The matched set this belongs to, shared by its twins in other languages —
   *  what a blindspot is counted by, so a source two editions cite and a third
   *  does not is one blindspot rather than two. */
  group: string;
  /** Every language whose article cites this source, this one included. */
  citedIn: Lang[];
}

export interface SourcesPayload {
  /** The languages the lists were matched across. A badge saying "cited in
   *  English" means nothing without it — the reader has to know which editions
   *  were looked at for a source to be *missing* from one. */
  langs: Lang[];
  sources: Partial<Record<Lang, SourceCitation[]>>;
}

export interface CoverageGap {
  qid: string;
  label: string;
  presentIn: Lang[];
  missingFrom: Lang[];
}

export interface TokenCount {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

/**
 * What a run spent.
 *
 * The totals are what they always were. `byModel` is the addition that makes the
 * figure priceable: heading alignment runs on Haiku and the claim diff on
 * Sonnet, three times the price, so a summed total cannot be costed at either
 * rate without being wrong in one direction. `costUsd` is computed once, at the
 * end of the run that spent it, and stored — prices move, and a comparison from
 * three weeks ago should keep reporting its own bill rather than being re-priced
 * by today's table.
 */
export interface Usage extends TokenCount {
  byModel?: Record<string, TokenCount>;
  costUsd?: number;
}

/** How much of the article a comparison actually read. */
export type ScopeKind = "preview" | "full";

/**
 * Where a preview stopped in one language.
 *
 * A preview reads a fixed number of characters off the top of every version, and
 * a character budget does not respect section boundaries — so the boundary is a
 * position, not an index: `section` counts body sections (the article's sections
 * with the key-facts block removed, as `Columns` renders them) and `chars` says
 * how far into that section the reading got. `chars: 0` means the budget ran out
 * on the boundary and `section` was not read at all; anything else means it was
 * read that far and the remainder belongs below the gate.
 */
export interface PreviewCut {
  section: number;
  chars: number;
}

export interface ComparisonScope {
  kind: ScopeKind;
  /** Per language, where this comparison stopped reading. Absent on a full run. */
  processedThrough?: Partial<Record<Lang, PreviewCut>>;
}

export interface ComparisonResult {
  qid: string;
  articles: Record<string, ArticleSnapshot>;
  claims: Claim[];
  coverage: CoverageGap[];
  promptVersion: string;
  parserVersion?: string;
  computedAt: string;
  usage: Usage;
  /** Absent on rows written before previews existed; treat those as full. */
  scope?: ComparisonScope;
  /** How many verbatim spans the model offered and how many were located. A low
   *  match rate means the prompt needs tightening, not the matcher loosening. */
  spans?: { offered: number; matched: number; droppedClaims: number };
  /** Sentence-by-sentence correspondence across the languages. Jev runs only. */
  alignment?: Alignment;
  /** The stored row's key, which is how a claim's explanation is asked for. */
  cacheKey?: string;
}

/** Provenance of a comparison that came out of the cache. Present only then. */
export interface CacheInfo {
  computedAt: string;
  /** Languages whose live revision has moved on since this was computed. Empty
   *  means the cached answer still describes exactly what is on Wikipedia now,
   *  which is the ordinary case and needs no badge. */
  edited: Lang[];
}

export interface ComparePayload extends ComparisonResult {
  fromCache: boolean;
  cache?: CacheInfo;
}

/**
 * One line of a streaming comparison, newest first as the run produces them.
 *
 * `done` carries the same `ComparisonResult` the non-streaming response returns,
 * and is always the last line of a successful run. The lines before it are
 * progress a client may render early and may equally ignore — which is what
 * keeps the streaming and plain-JSON paths from becoming two contracts.
 *
 * `error` replaces `done` when a run fails partway. It travels in the body
 * rather than in the status code because by the time the model fails the
 * response has been open, and 200, for a minute.
 */
export type CompareEvent =
  | { event: "articles"; qid: string; articles: Record<string, ArticleSnapshot> }
  | { event: "scope"; scope: ComparisonScope }
  | { event: "coverage"; coverage: CoverageGap[] }
  | { event: "claim"; claim: Claim }
  | { event: "done"; result: ComparisonResult; fromCache: boolean; cache?: CacheInfo }
  | { event: "error"; error: string };

/**
 * The site's own Anthropic balance is empty, so nothing can be read at all.
 *
 * It travels as the ordinary `error` string rather than as a field of its own,
 * so a client that knows nothing about it still shows a sentence that is true.
 * The one that does matches it exactly and offers the way out — donating and
 * telling me — which is the only thing a reader can do about it.
 */
export const OUT_OF_CREDIT =
  "Sorry, my account is literally empty and can't process anything at the moment.";

/* ---- accounts and credits ---- */

/**
 * Who is reading, and what they have left to spend.
 *
 * Identity comes from Better Auth; the two credit figures are our columns on its
 * user record. `articlesProcessed` and `readsOfThoseArticles` are the two numbers
 * the credit bar thanks somebody with — what they paid for, and how many people
 * have read it since, which is the part that makes the donation mean something.
 */
export interface MeResponse {
  email: string;
  creditCents: number;
  /** The most this account has ever held, so the meter has a denominator. */
  peakCreditCents: number;
  articlesProcessed: number;
  readsOfThoseArticles: number;
  /** Whether this account is still holding the sign-up credit, untouched and
   *  unadded-to. What the masthead's welcome note keys off — see the route. */
  newcomer: boolean;
  /** Whether the onboarding tour has been finished on any browser. Overrides
   *  this browser's own progress through it. */
  onboardingDone: boolean;
}

/** What the mock payment page submits. Amounts are whole cents. */
export interface DonateRequest {
  amountCents: number;
  maintenanceCents: number;
  monthly: boolean;
  /** Which surface sent them here, for the funnel. */
  from?: string;
}

/**
 * The exact proposition somebody agrees to by pressing the button on the reveal.
 *
 * Lives here because both sides need the same string and neither may own it: the
 * button renders it in the browser, and `/api/email-consent` stores it as the
 * evidence of what was agreed to. s.30A consent is consent to a particular
 * wording, so a log holding different words from the ones on the screen attests
 * to something that never happened. Changing this sentence changes what future
 * rows mean — old rows keep the words they were given, which is the point of
 * storing them per row rather than looking them up.
 */
export const EMAIL_CONSENT_WORDING = "Send me an email once payments are available";

/** What the pay button submits to redeem. Case and spacing are the server's problem. */
export interface CouponRequest {
  code: string;
}

/** A code that checked out. No balance in it: nothing has moved yet. */
export interface CouponCheck {
  code: string;
  cents: number;
}

/** A redeemed coupon. Separate from `DonateResponse`: a donation may not follow. */
export interface CouponResponse {
  code: string;
  grantedCents: number;
  /** The balance afterwards, so the page need not re-ask `/api/me`. */
  creditCents: number;
  message: string;
}

/**
 * The reveal.
 *
 * `granted` is false on every attempt after the first — the intent is still
 * recorded, because people trying to pay is the number worth knowing, but the
 * credit is not granted twice and the copy becomes a promise to come back to
 * them rather than a refusal.
 */
export interface DonateReveal {
  /** A mono eyebrow above the headline — sets the register (gift vs. promise). */
  kicker: string;
  /** The emotional anchor, set in the display face. */
  headline: string;
  /** The granted amount, formatted (e.g. "$5.00"), shown as a hero figure. */
  gift: string | null;
  /** The closing line — the thanks or the promise. */
  body: string;
}

export interface DonateResponse {
  granted: boolean;
  grantedCents: number;
  creditCents: number;
  /** The full sentence, kept flat for logs / screen readers / any fallback. */
  message: string;
  /** The same copy, split so the reveal can be laid out with hierarchy. */
  reveal: DonateReveal;
}

/** One row of the recently-cached list shown before any search. */
export interface RecentArticle {
  qid: string;
  title: string;
  /** Language the title above is written in, so the row can set its own `dir`. */
  lang: Lang;
  langs: Lang[];
  computedAt: string;
  /** Whether the cached run behind this row read the whole article or just the
   *  free preview. Rows written before previews existed have no scope in the
   *  database and are read as `"full"`, which is what they are. */
  scope: ScopeKind;
  /** Words per edition, counted the way `articleWords` counts them. An edition
   *  the subject does not have is a missing key rather than a zero. */
  words: Partial<Record<Lang, number>>;
  /** How many differences of each kind the cached run found. */
  claims: Record<ClaimType, number>;
}
