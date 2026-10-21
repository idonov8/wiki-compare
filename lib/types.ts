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
  /** How sure the engine was, 0 to 1. Absent on the demo fixtures' hand-built claims. */
  confidence?: number;
}

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
 * `byModel` files the same tokens under the model that spent them, which is what
 * makes the figure priceable when a run uses models at different rates.
 * `costUsd` is computed once, at the end of the run that spent it, and stored —
 * prices move, and a comparison from three weeks ago should keep reporting its
 * own bill rather than being re-priced by today's table.
 */
export interface Usage extends TokenCount {
  byModel?: Record<string, TokenCount>;
  costUsd?: number;
}

/** How much of the article a comparison actually read. Every run reads all of it. */
export type ScopeKind = "full";

export interface ComparisonScope {
  kind: ScopeKind;
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
  scope?: ComparisonScope;
  /** How many verbatim spans the model offered and how many were located. A low
   *  match rate means the prompt needs tightening, not the matcher loosening. */
  spans?: { offered: number; matched: number; droppedClaims: number };
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
  | { event: "coverage"; coverage: CoverageGap[] }
  | { event: "claim"; claim: Claim }
  | { event: "done"; result: ComparisonResult; fromCache: boolean; cache?: CacheInfo }
  | { event: "error"; error: string };

/** One row of the recently-cached list shown before any search. */
export interface RecentArticle {
  qid: string;
  title: string;
  /** Language the title above is written in, so the row can set its own `dir`. */
  lang: Lang;
  langs: Lang[];
  computedAt: string;
  /** Words per edition, counted the way `articleWords` counts them. An edition
   *  the subject does not have is a missing key rather than a zero. */
  words: Partial<Record<Lang, number>>;
  /** How many differences of each kind the cached run found. */
  claims: Record<ClaimType, number>;
}
