export const LANGS = ["en", "he", "ar"] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_META: Record<Lang, { label: string; native: string; dir: "ltr" | "rtl" }> = {
  en: { label: "English", native: "English", dir: "ltr" },
  he: { label: "Hebrew", native: "עברית", dir: "rtl" },
  ar: { label: "Arabic", native: "العربية", dir: "rtl" },
};

/**
 * How long a stored comparison keeps answering after the revisions it was
 * computed from have moved on.
 *
 * Keying on revision ids exactly is correct and far too eager. A Wikipedia
 * article of any prominence is edited several times a day, most of those edits
 * touching a category or a citation, and every one of them missed the cache and
 * bought a full re-read: three article fetches, a parse, and the model. Reading
 * within a window decouples the two — the key still records exactly which
 * revisions an answer describes, so a request reusing one across an edit knows
 * it is serving something older than live and can say so, rather than quietly
 * presenting stale text as current.
 *
 * Lives here rather than in lib/db.ts so the client can read it without pulling
 * the database driver into the browser bundle.
 */
export const CACHE_WINDOW_DAYS = 3;

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
}

/** A Wikipedia-internal link, as a character range into a section's `text`.
 *  `title` is the linked article's title in that section's own language. */
export interface LinkSpan {
  start: number;
  end: number;
  title: string;
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

export interface ComparisonScope {
  kind: ScopeKind;
  /** Per language, the index into the body sections (the article's sections with
   *  the key-facts block removed, as `Columns` renders them) of the first section
   *  this comparison did not read. Absent on a full run. */
  processedThrough?: Partial<Record<Lang, number>>;
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
}

/** Provenance of a comparison that came out of the cache. Present only then. */
export interface CacheInfo {
  computedAt: string;
  /** When this comparison stops answering for revisions other than its own. */
  expiresAt: string;
  /** Languages whose live revision has moved on since this was computed. Empty
   *  means the cached answer still describes exactly what is on Wikipedia now,
   *  which is the ordinary case and needs no badge. */
  edited: Lang[];
}

export interface ComparePayload extends ComparisonResult {
  fromCache: boolean;
  cache?: CacheInfo;
}

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
}

/** What the mock payment page submits. Amounts are whole cents. */
export interface DonateRequest {
  amountCents: number;
  maintenanceCents: number;
  monthly: boolean;
  /** Which surface sent them here, for the funnel. */
  from?: string;
  /**
   * Whether they ticked the box asking to be told when payments open.
   *
   * Separate from `monthly` and from the donation itself on purpose: s.30A wants
   * consent to receiving advertisements specifically, and a donation is not it.
   * Absent and false mean the same thing — nobody is written to — which is what
   * makes an unticked box the safe default rather than an ambiguous one.
   */
  emailOptIn?: boolean;
}

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
}
