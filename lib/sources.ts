import { type HTMLElement, parse } from "node-html-parser";
import { LANGS, type Lang, type Source, type SourceCitation, type SourcesPayload } from "./types";
import { toText } from "./wikipedia";

/**
 * Bumped whenever the extraction below changes what a footnote reduces to.
 *
 * Same reasoning as `PARSER_VERSION`: the sources cache is keyed on revision id,
 * which is immutable, but our reading of it is not. Kept separate from the
 * parser version on purpose — this pass reads a part of the page the article
 * parser throws away, so a change to either has no bearing on the other, and
 * sharing a version would invalidate hundreds of cached comparisons to fix a
 * regex in a footnote.
 */
export const SOURCES_VERSION = "s1";

/** A citation printed longer than this is a bibliography entry with an abstract
 *  attached; the tail of it tells a reader nothing they can scan a list by. */
const MAX_TEXT = 300;

/** Inside a footnote: the caret back to the body, the template stylesheet, the
 *  date we retrieved it on, the maintenance notes Wikipedia hides in CSS, and
 *  the metadata blob below — read first, then removed. All of it would
 *  otherwise land in the one line a footnote reduces to. */
const CITE_CHROME = [
  "style",
  ".mw-cite-backlink",
  ".reference-accessdate",
  ".cs1-maint",
  ".cs1-hidden-error",
  ".Z3988",
] as const;

/**
 * The machine-readable half of a citation.
 *
 * Every edition renders CS1/CS2 citations with an empty `<span class="Z3988">`
 * whose title attribute is an OpenURL context object — the title, work, date,
 * ISBN and DOI as fields rather than as prose. It is the one part of a footnote
 * that reads the same in all three languages, so where it exists the identity of
 * the source is read from it rather than guessed at from the rendered line.
 */
function coins(li: HTMLElement): URLSearchParams {
  const raw = li.querySelector("span.Z3988")?.getAttribute("title");
  return new URLSearchParams(raw ?? "");
}

/** Query parameters that identify the campaign that sent a reader, not the page
 *  they were sent to. Two editions citing the same article through different
 *  campaigns are citing the same article. */
const TRACKING = /^(utm_|fbclid$|gclid$|mc_[ce]id$|ref$|referer$|source$|via$)/i;

/**
 * An archived copy, unwrapped back to what it is a copy of.
 *
 * This is most of the reason cross-language matching works at all: an edition
 * that cites a dead link tends to cite the Wayback copy of it, and the edition
 * next to it tends to cite the live URL. Left wrapped, the same newspaper
 * article is two sources and both versions look as though they read something
 * the other did not.
 */
function unwrapArchive(url: string): string {
  const wayback = /^https?:\/\/(?:web\.)?archive\.org\/web\/[^/]+\/(https?:\/\/.+)$/i.exec(url);
  if (wayback) return wayback[1];
  const today = /^https?:\/\/archive\.(?:is|ph|today|li|vn|fo)\/[^/]*\/?(https?:\/\/.+)$/i.exec(url);
  if (today) return today[1];
  const webcite = /^https?:\/\/(?:www\.)?webcitation\.org\/query\?.*\burl=([^&]+)/i.exec(url);
  if (webcite) {
    try {
      return decodeURIComponent(webcite[1]);
    } catch {
      return url;
    }
  }
  return url;
}

/**
 * A URL reduced to the document it names.
 *
 * Host without `www.` or a mobile prefix, path without its trailing slash, and
 * the query minus whatever only says who sent the reader. The query stays
 * because on a great many sites it is the whole of the address that varies:
 * every Google Books citation in every language is `books.google.com/books`,
 * and dropping `?id=` merged an Arabic dictionary, a history of trade and a
 * 1922 monograph into one source cited by all three editions. Over-splitting
 * costs a match; over-merging prints a strikethrough that is a lie.
 */
export function urlKey(input: string): string | null {
  let url: URL;
  try {
    url = new URL(unwrapArchive(input));
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;

  const host = url.hostname.toLowerCase().replace(/^(www|m|mobile|amp)\./, "");
  let path = url.pathname.replace(/\/+$/, "");
  try {
    path = decodeURIComponent(path);
  } catch {
    // Malformed percent-encoding: the raw path still identifies the document.
  }

  const query = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING.test(k))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  if (query) return `url:${host}${path}?${query}`;

  // A bare domain is a publisher, not a document. Two editions both linking to
  // a newspaper's front page are not citing the same thing.
  return path ? `url:${host}${path}` : null;
}

function hostOf(input: string): string | undefined {
  try {
    return new URL(unwrapArchive(input)).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return undefined;
  }
}

/** DOIs are case-insensitive and routinely cited with a proxy in front. */
function doiKey(value: string): string | null {
  const match = /\b(10\.\d{4,9}\/[^\s"'<>)\]}]+)/.exec(value);
  return match ? `doi:${match[1].toLowerCase().replace(/[.,;]+$/, "")}` : null;
}

/** ISBN-10 and ISBN-13 name the same book, so both fold to the 9 digits they
 *  share; the check digit and the 978 prefix carry no identity. */
function isbnKey(value: string): string | null {
  const digits = value.replace(/[^\dXx]/g, "").toUpperCase();
  if (digits.length === 13 && /^97[89]/.test(digits)) return `isbn:${digits.slice(3, 12)}`;
  if (digits.length === 10) return `isbn:${digits.slice(0, 9)}`;
  return null;
}

/**
 * An ISBN printed in the citation line, taken only where the line says it is
 * one.
 *
 * A bare run of digits and dashes long enough to be an ISBN is also a date
 * range, a phone number or a docket reference, and a wrong ISBN is not a
 * missing match but a false one — two unrelated books reported as the source
 * both versions share. Every edition prints the label in Latin script; the
 * other two spellings are what Hebrew and Arabic put in front of it.
 */
function isbnFromText(text: string): string | null {
  const match = /(?:ISBN|ردمك|מסת"ב)\s*(?:1[03])?[\s:]*([\dXx][\dXx‐-― -]{8,20})/i.exec(text);
  return match ? isbnKey(match[1]) : null;
}

/**
 * A title reduced to the words in it.
 *
 * The weakest of the four keys and the one that earns its place on books and on
 * newspapers cited without a link: an English-language source quoted in the
 * Hebrew article keeps its English title, which is exactly the case a URL cannot
 * catch. Kept honest by the length floor — a short title is a phrase two
 * unrelated citations can share, a long one is not.
 */
function titleKey(value: string): string | null {
  const folded = value
    .toLowerCase()
    .replace(/[֑-ׇً-ْ]/g, "") // Hebrew and Arabic diacritics
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  return folded.length >= 18 ? `title:${folded}` : null;
}

/**
 * The title a citation states, or nothing.
 *
 * Run through `toText` because the field is wikitext once removed: a pipe in a
 * headline reaches the context object as `&#124;` and would otherwise be
 * printed that way. Anything left with no letters in it is not a title — link
 * text is routinely a page range ("4–3") or the name of an archive — and the
 * entry falls back to the citation line, which at least names the work.
 */
function titleOf(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const title = toText(raw).replace(/\s+/g, " ").trim();
  return /\p{L}{3}/u.test(title) ? title : undefined;
}

/**
 * The footnotes of one article, in the order it prints them.
 *
 * Reads the reference lists the article parser deliberately strips: the same
 * `<ol class="references">` that `CHROME_SELECTORS` removes, because a citation
 * is apparatus rather than prose and a model comparing the prose should not see
 * it. Nothing here goes near a model — a source is recognised by its URL, DOI,
 * ISBN or title, all of which are the same string in every language.
 */
export function parseSources(html: string): Source[] {
  const root = parse(html);
  const out: Source[] = [];
  const seen = new Set<string>();

  for (const list of root.querySelectorAll("ol.references")) {
    for (const li of list.querySelectorAll("li")) {
      const meta = coins(li);
      for (const selector of CITE_CHROME) {
        for (const node of li.querySelectorAll(selector)) node.remove();
      }

      const links = li
        .querySelectorAll("a.external")
        .map((a) => a.getAttribute("href") ?? "")
        .filter((href) => /^(https?:)?\/\//.test(href))
        .map((href) => (href.startsWith("//") ? `https:${href}` : href));

      const text = toText(li.innerHTML).replace(/\s+/g, " ").trim();
      const title = titleOf(
        meta.get("rft.atitle") ??
          meta.get("rft.btitle") ??
          meta.get("rft.title") ??
          li.querySelector("a.external")?.textContent,
      );

      const keys = new Set<string>();
      for (const link of links) {
        const key = urlKey(link);
        if (key) keys.add(key);
        const doi = doiKey(link);
        if (doi) keys.add(doi);
      }
      for (const field of ["rft_id", "rft.isbn"]) {
        const value = meta.get(field);
        if (!value) continue;
        const key = urlKey(value) ?? doiKey(value) ?? isbnKey(value);
        if (key) keys.add(key);
      }
      const isbn = isbnFromText(text);
      if (isbn) keys.add(isbn);
      const titled = title && titleKey(title);
      if (titled) keys.add(titled);

      // The first link that is not an archive of another one: what a reader
      // pressing the entry should get, which is the source rather than a
      // snapshot of it.
      const url = links.find((l) => unwrapArchive(l) === l) ?? links[0];

      // Nothing to recognise it by is not a source. Explanatory notes — "Dweik
      // was Speaker following the 2006 election" — are footnotes too, and
      // belong in the article rather than in a list of what it was written
      // from; so is a printed book cited with no link, ISBN or stated title,
      // which nothing could match across languages anyway.
      if (!keys.size || !text) continue;

      const source: Source = {
        text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT).trimEnd()}…` : text,
        title,
        url: url ? unwrapArchive(url) : undefined,
        domain: url ? hostOf(url) : undefined,
        keys: [...keys],
      };

      // The same source cited from three different sentences is three footnotes
      // in some editions and one named reference in others. Here it is one
      // source either way.
      const identity = source.keys.join("|");
      if (seen.has(identity)) continue;
      seen.add(identity);
      out.push(source);
    }
  }

  return out;
}

/** Union-find over every source in every language, joined by shared keys. */
class Groups {
  private parent = new Map<number, number>();

  find(i: number): number {
    const up = this.parent.get(i);
    if (up === undefined || up === i) return i;
    const root = this.find(up);
    this.parent.set(i, root);
    return root;
  }

  union(a: number, b: number): void {
    const [x, y] = [this.find(a), this.find(b)];
    if (x !== y) this.parent.set(y, x);
  }
}

/**
 * The same source, found in more than one language's list.
 *
 * Two footnotes are the same source when they share any identity key, and
 * sameness is transitive: the Hebrew footnote that matches the English one on a
 * URL and the Arabic one that matches it on a DOI are all one source, which is
 * what makes "cited in all three" answerable at all.
 *
 * Deliberately arithmetic rather than judgement. A model asked which citations
 * correspond would be better at the ragged cases — a book cited by two different
 * translations of its title — and would also cost a run's worth of tokens per
 * article. This costs nothing, runs on the article the moment it is fetched,
 * and is wrong in a way a reader can see: an unmatched twin shows up as two
 * unique sources rather than as a false claim.
 */
export function matchSources(byLang: Partial<Record<Lang, Source[]>>): SourcesPayload {
  const langs = LANGS.filter((l) => byLang[l]);
  const flat: { lang: Lang; source: Source }[] = [];
  for (const lang of langs) {
    for (const source of byLang[lang] ?? []) flat.push({ lang, source });
  }

  const groups = new Groups();
  const owner = new Map<string, number>();
  flat.forEach(({ source }, i) => {
    for (const key of source.keys) {
      const first = owner.get(key);
      if (first === undefined) owner.set(key, i);
      else groups.union(first, i);
    }
  });

  const citedIn = new Map<number, Set<Lang>>();
  flat.forEach(({ lang }, i) => {
    const root = groups.find(i);
    const set = citedIn.get(root) ?? new Set<Lang>();
    set.add(lang);
    citedIn.set(root, set);
  });

  const sources: Partial<Record<Lang, SourceCitation[]>> = {};
  const kept = new Map<Lang, Set<number>>();
  flat.forEach(({ lang, source }, i) => {
    const root = groups.find(i);
    const already = kept.get(lang) ?? new Set<number>();
    // Two footnotes of one language that turned out to be the same source
    // collapse into the entry the article printed first.
    if (already.has(root)) return;
    already.add(root);
    kept.set(lang, already);
    (sources[lang] ??= []).push({
      text: source.text,
      title: source.title,
      url: source.url,
      domain: source.domain,
      group: `g${root}`,
      citedIn: LANGS.filter((l) => citedIn.get(root)?.has(l)),
    });
  });

  for (const lang of langs) sources[lang] ??= [];
  return { langs, sources };
}
