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

export interface ArticleImage {
  src: string;
  alt?: string;
  width?: number;
  height?: number;
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

export interface ComparisonResult {
  qid: string;
  articles: Record<string, ArticleSnapshot>;
  claims: Claim[];
  coverage: CoverageGap[];
  promptVersion: string;
  parserVersion?: string;
  computedAt: string;
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens: number };
  /** How many verbatim spans the model offered and how many were located. A low
   *  match rate means the prompt needs tightening, not the matcher loosening. */
  spans?: { offered: number; matched: number; droppedClaims: number };
}

export interface ComparePayload extends ComparisonResult {
  fromCache: boolean;
}
