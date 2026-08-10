import { type HTMLElement, type Node, parse } from "node-html-parser";
import type { ArticleImage, ArticleSnapshot, Lang, LinkSpan, Section } from "./types";
import { KEY_FACTS_HEADING, LANGS, LEAD_HEADING } from "./types";

/**
 * Bumped whenever parsing changes what a snapshot contains.
 *
 * The articles cache is keyed on revision id, which is immutable — but only the
 * *input* is immutable, not our reading of it. Without this, a parser fix would
 * be invisible to every article already cached: the revision has not changed, so
 * the stale snapshot keeps being served, and the fix appears not to work. Also
 * folded into the comparison key, since a comparison is downstream of a parse.
 */
export const PARSER_VERSION = "v6";

/**
 * Wikimedia's rate limits are tiered by how well a client identifies itself: a
 * request carrying nothing but an IP gets 10/min, one with a policy-compliant
 * User-Agent gets 200/min. A cold comparison costs upwards of fifty requests, so
 * the low tier fails outright — and because that tier is keyed on IP, it is
 * shared with every other unidentified client on the same egress, which is why
 * the resulting 429s look intermittent rather than constant.
 *
 * So the contact information below is load-bearing, not decoration. The format
 * is fixed by policy: <client>/<version> (<contact url or email>), and the
 * contact has to be something that actually reaches a maintainer.
 * https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy
 */
const CONTACT = process.env.WIKI_CONTACT || "https://wiki-compare.vercel.app; contact@wikicompare.app";
const UA = `wiki-compare/0.1 (${CONTACT})`;
const MAX_SECTION_CHARS = 4000;
const MAX_LINKS = 400;

async function api<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params }).toString();
  const res = await fetch(url, { headers: { "User-Agent": UA }, next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`${url.host} returned ${res.status}`);
  return (await res.json()) as T;
}

const wiki = (lang: string) => `https://${lang}.wikipedia.org/w/api.php`;
const WIKIDATA = "https://www.wikidata.org/w/api.php";

/** The language whose Wikipedia a query is most likely written for. Script is
 *  the only signal available before anything is fetched, and for these three
 *  editions it is enough: Hebrew and Arabic have their own blocks. */
export function guessLang(query: string): Lang {
  if (/[\u0590-\u05ff]/.test(query)) return "he";
  if (/[\u0600-\u06ff]/.test(query)) return "ar";
  return "en";
}

/** A pasted article URL, as language + title. Any Wikipedia edition is accepted,
 *  not just the three compared: the QID lookup only needs one wiki that has the
 *  page, and someone reading the French article should be able to paste it. */
export function parseWikipediaUrl(input: string): { lang: string; title: string } | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const host = /^([a-z-]+)\.(?:m\.)?wikipedia\.org$/.exec(url.hostname);
  if (!host) return null;
  const path = /^\/wiki\/(.+)$/.exec(url.pathname);
  const raw = path?.[1] ?? url.searchParams.get("title");
  if (!raw) return null;
  try {
    return { lang: host[1], title: decodeURIComponent(raw).replace(/_/g, " ") };
  } catch {
    return null;
  }
}

export interface SearchHit {
  lang: string;
  title: string;
  description?: string;
  url: string;
}

/** Title search against one edition, with each hit's short description — the
 *  line that tells apart the film, the album and the city of the same name. */
export async function searchArticles(lang: string, query: string, limit = 8): Promise<SearchHit[]> {
  const res = await api<{
    query?: { pages?: { index?: number; title: string; description?: string }[] };
  }>(wiki(lang), {
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrlimit: String(limit),
    gsrnamespace: "0",
    prop: "description",
  });

  return (res.query?.pages ?? [])
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((page) => ({
      lang,
      title: page.title,
      description: page.description,
      url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
    }));
}

/** Find the Wikidata item for a title, then the equivalent title in each language. */
export async function resolveSitelinks(
  title: string,
  lang: string,
): Promise<{ qid: string; titles: Partial<Record<Lang, string>> }> {
  const page = await api<{ query?: { pages?: { pageprops?: { wikibase_item?: string }; missing?: boolean }[] } }>(
    wiki(lang),
    { action: "query", prop: "pageprops", ppprop: "wikibase_item", titles: title, redirects: "1" },
  );
  const first = page.query?.pages?.[0];
  if (!first || first.missing) throw new Error(`No ${lang}.wikipedia article called “${title}”.`);
  const qid = first.pageprops?.wikibase_item;
  if (!qid) throw new Error(`“${title}” has no Wikidata item, so it can't be matched across languages.`);

  const entity = await api<{ entities?: Record<string, { sitelinks?: Record<string, { title: string }> }> }>(
    WIKIDATA,
    { action: "wbgetentities", ids: qid, props: "sitelinks", sitefilter: LANGS.map((l) => `${l}wiki`).join("|") },
  );
  const sitelinks = entity.entities?.[qid]?.sitelinks ?? {};
  const titles: Partial<Record<Lang, string>> = {};
  for (const l of LANGS) {
    const t = sitelinks[`${l}wiki`]?.title;
    if (t) titles[l] = t;
  }
  return { qid, titles };
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
};

function decode(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/**
 * Chrome Wikipedia wraps around prose. Removed from the parsed tree rather than
 * by regex: every one of these nests (a `<table>` inside an infobox, a `<span>`
 * inside `.mw-editsection`, a `<div>` inside a navbox), and a non-greedy match
 * stops at the first closing tag, leaving the remainder behind as body text.
 */
const CHROME_SELECTORS = [
  "script",
  "style",
  "link",
  "figure",
  "sup.reference",
  ".mw-editsection",
  "ol.references",
  ".reflist",
  ".mw-references-wrap",
  ".navbox",
  ".navbox-inner",
  ".vertical-navbox",
  ".sidebar",
  ".hatnote",
  ".thumb",
  ".metadata",
  ".ambox",
  ".portalbox",
  ".noprint",
  ".mw-empty-elt",
  ".mw-jump-link",
  ".navigation-not-searchable",
] as const;

/** Strip the chrome Wikipedia wraps around prose. What survives is what a
 *  reader actually reads. Infoboxes are pulled out separately first, by
 *  `extractKeyFacts` — they carry the comparable figures. */
export function stripChrome(html: string): string {
  const root = parse(html);
  cleanTree(root);
  return root.innerHTML;
}

function removeChrome(root: HTMLElement): void {
  for (const selector of CHROME_SELECTORS) {
    for (const node of root.querySelectorAll(selector)) node.remove();
  }
}

function removeTables(root: HTMLElement): void {
  for (const node of root.querySelectorAll("table")) node.remove();
}

function cleanTree(root: HTMLElement): void {
  // Order matters: a navbox is a table too, so the class selectors run first,
  // and `extractKeyFacts` reads the infobox in between.
  removeChrome(root);
  removeTables(root);
}

/**
 * The infobox, flattened to `Label: value` lines.
 *
 * It is chrome by layout but not by content: the figures most worth comparing
 * across versions live here rather than in prose. On this project's own test
 * case the 2006 seat split (Hamas 74 / Fatah 45) appears in the English and
 * Arabic infoboxes and nowhere in either article's running text, so dropping
 * the infobox makes that contradiction undetectable in two of three languages.
 */
function extractKeyFacts(root: HTMLElement): string {
  const infobox = root.querySelector("table.infobox");
  if (!infobox) return "";

  const lines: string[] = [];
  for (const row of infobox.querySelectorAll("tr")) {
    const flat = (el: HTMLElement | null) =>
      el ? toText(el.innerHTML).replace(/\s*\n+\s*/g, " ").trim() : "";
    const label = flat(row.querySelector("th"));
    const value = flat(row.querySelector("td"));
    const line = label && value ? `${label}: ${value}` : value || label;
    if (line && line.length > 1) lines.push(line);
  }

  // De-duplicate: infobox headers frequently repeat the row label beneath them.
  return [...new Set(lines)].join("\n");
}

/** Resolve the protocol-relative `//upload.wikimedia.org/…` srcs Wikipedia
 *  emits, and the occasional site-relative one, to an absolute https URL. */
function resolveSrc(src: string, lang: Lang): string | null {
  if (!src) return null;
  if (src.startsWith("//")) return `https:${src}`;
  if (src.startsWith("http")) return src;
  if (src.startsWith("/")) return `https://${lang}.wikipedia.org${src}`;
  return null;
}

/** The highest-density URL a thumbnail offers, so it stays crisp when shown
 *  larger than its 1x size. Falls back to `src`. */
function bestSrc(img: HTMLElement): string {
  const srcset = img.getAttribute("srcset");
  if (srcset) {
    const best = srcset
      .split(",")
      .map((entry) => {
        const [url, density] = entry.trim().split(/\s+/);
        return { url, density: parseFloat(density) || 1 };
      })
      .sort((a, b) => b.density - a.density)[0];
    if (best?.url) return best.url;
  }
  return img.getAttribute("src") ?? "";
}

/**
 * Whether an upload URL points at Commons rather than at a local wiki, which is
 * the licence question in disguise.
 *
 * Commons accepts freely licensed and public-domain files only — it is the one
 * Wikimedia project where "is this reusable outside Wikipedia" is answered by
 * the fact of the file being there. Files uploaded *locally* to an edition are
 * overwhelmingly the opposite case: album covers, film posters, logos, portraits
 * of living people, kept under a non-free rationale that covers their use in
 * that one encyclopedia article and nothing else. Reproducing those here would
 * be outside the rationale no matter what credit we printed beside them.
 *
 * The two are told apart by a path segment — /wikipedia/commons/… against
 * /wikipedia/en/… — which is stable, and cheaper than asking the API about
 * candidates we are going to discard anyway.
 */
const onCommons = (src: string) => /^https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\//.test(src);

/**
 * The canonical `File:…` title behind a rendered thumbnail.
 *
 * The wrapping anchor carries it directly and is preferred, because it is what
 * MediaWiki itself considers the file. Failing that it is recoverable from the
 * upload URL, where a thumbnail keeps the original name one segment above the
 * resized copy: …/commons/thumb/a/ab/Foo.jpg/330px-Foo.jpg.
 */
function fileTitleOf(img: HTMLElement, src: string): string | null {
  for (let node: HTMLElement | null = img.parentNode; node; node = node.parentNode) {
    const href = node.getAttribute?.("href");
    const named = href && /\/wiki\/([^#?]*:[^#?]+)$/.exec(href);
    if (named) {
      try {
        // Every edition names the namespace in its own language, so the prefix
        // is normalised rather than matched: Commons answers to File: alone.
        return `File:${decodeURIComponent(named[1]).replace(/^[^:]*:/, "").replace(/_/g, " ")}`;
      } catch {
        return null;
      }
    }
  }

  const path = /\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/]+)/.exec(src);
  if (!path) return null;
  try {
    return `File:${decodeURIComponent(path[1]).replace(/_/g, " ")}`;
  } catch {
    return null;
  }
}

/**
 * The article's lead photo, taken from the infobox (then any inline figure as a
 * fallback). Read from the parsed tree before `stripChrome` discards figures.
 *
 * Icons — flags, pog markers, maintenance-template glyphs — are filtered by
 * rendered width, and photographs (`.jpg`) are preferred over the logos and
 * coats of arms an infobox also carries, so the picture shown is the one a
 * reader would call the article's photo.
 *
 * Non-Commons candidates are skipped rather than ranked last: an article whose
 * only picture is non-free should show no picture. The photo returned here is
 * still uncredited — `withImageCredit` finishes the job, and is what decides
 * whether it can be shown at all.
 */
export function extractLeadImage(html: string, lang: Lang): ArticleImage | undefined {
  const root = parse(html);
  const candidates = [
    ...root.querySelectorAll("table.infobox img"),
    ...root.querySelectorAll(".infobox-image img"),
    ...root.querySelectorAll("figure img"),
    ...root.querySelectorAll(".thumb img"),
  ]
    .map((img) => ({ img, width: Number(img.getAttribute("width")) || 0 }))
    .filter(({ width }) => width >= 100);

  candidates.sort((a, b) => rankPhoto(a.img) - rankPhoto(b.img));

  for (const { img, width } of candidates) {
    const src = resolveSrc(bestSrc(img), lang);
    if (!src || !onCommons(src)) continue;
    const file = fileTitleOf(img, src);
    if (!file) continue;
    return {
      src,
      file,
      alt: img.getAttribute("alt") || undefined,
      width: width || undefined,
      height: Number(img.getAttribute("height")) || undefined,
    };
  }
  return undefined;
}

const COMMONS = "https://commons.wikimedia.org/w/api.php";

/** Licence names that permit reuse. Commons membership already implies this, so
 *  the list is a second opinion rather than the decision — it exists to catch a
 *  file that slipped in under a rationale Commons should not have accepted. */
const FREE_LICENSE = /^(cc[ \-0-9]|cc0|public domain|pd|gfdl|fal\b|attribution\b|copyrighted free use|no restrictions)/i;
const NON_FREE = /fair use|non-?free|all rights reserved/i;

/**
 * Wikimedia returns `Artist` and friends as HTML — a linked username, often
 * wrapped in spans. The credit line wants the name it renders to.
 *
 * The author field is a fragment of the Commons file page, so it arrives with
 * that page's TemplateStyles attached: an author credited through a userbox
 * template comes back as `<style>…</style>Wereon`. `textContent` counts the
 * rules inside a `<style>` as text, which printed a stylesheet in front of the
 * photographer's name — so the stylesheet is dropped from the tree first.
 */
export function plainText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const root = parse(html);
  for (const node of root.querySelectorAll("style")) node.remove();
  for (const node of root.querySelectorAll("script")) node.remove();
  const text = root.textContent.replace(/\s+/g, " ").trim();
  return text || undefined;
}

interface ExtMetadata {
  extmetadata?: Record<string, { value?: string }>;
  descriptionurl?: string;
}

/**
 * Attach the author and licence a Commons file is offered under, or drop the
 * image.
 *
 * Dropping is the right failure. Every branch that returns undefined here is a
 * case where we could not establish permission — the file vanished, the API was
 * unreachable, the terms came back non-free or unreadable — and a photograph we
 * cannot name terms for is one we have no licence to publish. Showing it anyway
 * and hoping is the single most expensive shortcut available in this file.
 */
export async function withImageCredit(image: ArticleImage): Promise<ArticleImage | undefined> {
  let page: (ExtMetadata & { missing?: boolean }) | undefined;
  try {
    const res = await api<{ query?: { pages?: (ExtMetadata & { missing?: boolean })[] } }>(COMMONS, {
      action: "query",
      titles: image.file,
      prop: "imageinfo",
      iiprop: "extmetadata|url",
      iiextmetadatafilter: "Artist|Credit|LicenseShortName|License|LicenseUrl|UsageTerms",
    });
    page = res.query?.pages?.[0];
  } catch {
    return undefined;
  }
  if (!page || page.missing) return undefined;

  const info = (page as { imageinfo?: ExtMetadata[] }).imageinfo?.[0];
  const meta = info?.extmetadata ?? {};
  const value = (key: string) => meta[key]?.value;

  const license = plainText(value("LicenseShortName")) ?? plainText(value("License"));
  if (!license || NON_FREE.test(license) || !FREE_LICENSE.test(license)) return undefined;

  const fileUrl =
    info?.descriptionurl ??
    `https://commons.wikimedia.org/wiki/${encodeURIComponent(image.file.replace(/ /g, "_"))}`;

  return {
    ...image,
    credit: {
      artist: plainText(value("Artist")) ?? plainText(value("Credit")),
      license,
      licenseUrl: value("LicenseUrl"),
      fileUrl,
    },
  };
}

const rankPhoto = (img: HTMLElement) => (/\.jpe?g/i.test(img.getAttribute("src") ?? "") ? 0 : 1);

/** Headings whose sections are navigation apparatus rather than article content.
 *  Filtering only the English names left the Hebrew and Arabic columns carrying
 *  reference and external-link sections the English column had already dropped,
 *  which manufactured false "unique to he/ar" claims and skewed every length
 *  ratio in the section screener. */
const BOILERPLATE_HEADINGS = [
  // en
  /^(references|external links|see also|notes|bibliography|further reading|sources|citations|footnotes)$/i,
  // he
  /^(קישורים חיצוניים|הערות שוליים|ראו גם|ראה גם|לקריאה נוספת|מקורות|ביבליוגרפיה|הפניות)$/,
  // ar
  /^(مراجع|المراجع|وصلات خارجية|روابط خارجية|انظر ايضا|اقرا ايضا|مصادر|المصادر|هوامش|الهوامش|مواقع خارجية|معرض صور)$/,
];

/** Arabic text carries optional diacritics that vary between articles, so
 *  "انظر أيضًا" and "انظر ايضا" are the same heading. Fold them together. */
function foldArabic(s: string): string {
  return s
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[ى]/g, "ي")
    .trim();
}

function isBoilerplate(heading: string): boolean {
  const folded = foldArabic(heading);
  return BOILERPLATE_HEADINGS.some((re) => re.test(heading) || re.test(folded));
}

function headingOf(node: Node): { text: string; level: number } | null {
  const el = node as HTMLElement;
  if (!el.tagName) return null;

  const direct = /^H([23])$/i.exec(el.tagName);
  if (direct) return { text: toText(el.innerHTML), level: Number(direct[1]) };

  // Current Wikipedia wraps each heading in <div class="mw-heading mw-heading2">.
  if ((el.getAttribute("class") ?? "").includes("mw-heading")) {
    const h = el.querySelector("h2") ?? el.querySelector("h3");
    if (h) return { text: toText(h.innerHTML), level: Number(h.tagName[1]) };
  }
  return null;
}

export function toText(html: string): string {
  return decode(
    html
      .replace(/<\/(p|li|dd|dt|div|h[1-6])>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "• ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

/** The article title an anchor points at, or null if it isn't a plain
 *  article-namespace link (red links, `File:`/`Category:`/… and external links
 *  are dropped). Shared shape with `linkTitlesOf`. */
function articleTitleFromHref(href: string, cls: string): string | null {
  if (cls.split(/\s+/).includes("new")) return null;
  const match = /^(?:\.\/|\/wiki\/)([^#?]+)/.exec(href);
  if (!match) return null;
  let title: string;
  try {
    title = decodeURIComponent(match[1]).replace(/_/g, " ");
  } catch {
    return null;
  }
  return !title || title.includes(":") ? null : title;
}

/**
 * Locate each Wikipedia-internal link as a character range into `text` (the
 * plain text `toText` produced for the same html), so the client can turn them
 * into links to our own comparison of that article without re-parsing.
 *
 * `qidByTitle` is optional and, when given, stamps each span with the Wikidata
 * item its title resolved to — the same id the coverage diff groups on, so a
 * span can be matched to the concept that diff counted it as.
 *
 * ponytail: a forward-moving cursor binds each anchor to the first occurrence
 * of its label at or after the previous one — document order, so it is right in
 * practice. Ceiling: a link whose visible text repeats an earlier identical
 * phrase on the way could bind to the wrong occurrence; upgrade by tracking
 * offsets through `toText`'s normalisation instead of re-finding the label.
 */
function extractLinks(html: string, text: string, qidByTitle?: Map<string, string>): LinkSpan[] {
  const root = parse(html);
  const spans: LinkSpan[] = [];
  let cursor = 0;
  for (const anchor of root.querySelectorAll("a")) {
    const title = articleTitleFromHref(
      anchor.getAttribute("href") ?? "",
      anchor.getAttribute("class") ?? "",
    );
    if (!title) continue;
    const label = toText(anchor.innerHTML).replace(/\s+/g, " ").trim();
    if (!label) continue;
    const start = text.indexOf(label, cursor);
    if (start === -1) continue; // dropped by MAX_SECTION_CHARS or reworded by normalisation
    spans.push({ start, end: start + label.length, title, qid: qidByTitle?.get(title) });
    cursor = start + label.length;
  }
  return spans;
}

export function splitSections(html: string, qidByTitle?: Map<string, string>): Section[] {
  const root = parse(html);

  // Chrome first, then key facts off the surviving infobox, then the tables.
  removeChrome(root);
  const keyFacts = extractKeyFacts(root);
  removeTables(root);

  const container = root.querySelector(".mw-parser-output") ?? root;
  const sections: Section[] = [];

  let heading = LEAD_HEADING;
  let level = 1;
  let buffer: string[] = [];

  const flush = () => {
    const html = buffer.join("");
    const text = toText(html).slice(0, MAX_SECTION_CHARS);
    if (text.length > 40 && !isBoilerplate(heading)) {
      sections.push({ heading, level, text, links: extractLinks(html, text, qidByTitle) });
    }
    buffer = [];
  };

  for (const node of container.childNodes) {
    const next = headingOf(node);
    if (next) {
      flush();
      heading = next.text;
      level = next.level;
      continue;
    }
    buffer.push(node.toString());
  }
  flush();

  if (keyFacts.length > 40) {
    // After the lead, not before it. The lead is the article's own summary and
    // should be the first thing read in each column; the key-facts block is
    // apparatus, and long enough that putting it first pushed every lead below
    // the fold.
    const afterLead = sections.findIndex((s) => s.heading === LEAD_HEADING) + 1;
    sections.splice(afterLead, 0, {
      heading: KEY_FACTS_HEADING,
      level: 1,
      text: keyFacts.slice(0, MAX_SECTION_CHARS),
    });
  }

  return sections;
}

/**
 * Map article titles to Wikidata QIDs, 50 at a time.
 *
 * This asks the source wiki, not Wikidata. `wbgetentities` with `sites`+`titles`
 * answers keyed by QID and never echoes the title back — the response for three
 * titles is `{"entities":{"Q38799":{"id":"Q38799","type":"item"}}}` — so there is
 * no way to recover which title produced which id, and the previous
 * implementation silently returned an empty map on every call. `prop=pageprops`
 * returns the association directly, and follows redirects while it is at it.
 */
async function titlesToQids(lang: Lang, titles: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    try {
      const res = await api<{
        query?: {
          normalized?: { from: string; to: string }[];
          redirects?: { from: string; to: string }[];
          pages?: { title?: string; missing?: boolean; pageprops?: { wikibase_item?: string } }[];
        };
      }>(wiki(lang), {
        action: "query",
        prop: "pageprops",
        ppprop: "wikibase_item",
        titles: batch.join("|"),
        redirects: "1",
      });

      const qidByTitle = new Map<string, string>();
      for (const page of res.query?.pages ?? []) {
        const qid = page.pageprops?.wikibase_item;
        if (page.title && qid && !page.missing) qidByTitle.set(page.title, qid);
      }

      // Follow the normalisation/redirect chains back so callers can look up by
      // the title they actually passed in.
      const hops = [...(res.query?.normalized ?? []), ...(res.query?.redirects ?? [])];
      for (const title of batch) {
        let resolved = title;
        for (let hop = 0; hop < 4; hop++) {
          const next = hops.find((h) => h.from === resolved);
          if (!next) break;
          resolved = next.to;
        }
        const qid = qidByTitle.get(resolved) ?? qidByTitle.get(title);
        if (qid) out.set(title, qid);
      }
    } catch {
      // A failed batch costs coverage detail, not correctness. Keep going.
    }
  }
  return out;
}

/** One small call that tells us the current revision, so a cache hit avoids
 *  parsing and re-resolving hundreds of links. */
export async function currentRevid(lang: Lang, title: string): Promise<number | null> {
  const res = await api<{ query?: { pages?: { missing?: boolean; revisions?: { revid: number }[] }[] } }>(
    wiki(lang),
    { action: "query", prop: "revisions", rvprop: "ids", titles: title, redirects: "1" },
  );
  const page = res.query?.pages?.[0];
  return page?.missing ? null : (page?.revisions?.[0]?.revid ?? null);
}

/** The raw `action=parse` payload. Exported so the fixture recorder can capture
 *  exactly what the API returned, rather than a post-processed view of it. */
export interface ParsedPage {
  title: string;
  revid: number;
  text: string;
  links?: { ns: number; title: string; exists?: boolean }[];
}

export async function fetchParsedPage(lang: Lang, title: string): Promise<ParsedPage> {
  const parsed = await api<{ parse?: ParsedPage }>(wiki(lang), {
    action: "parse",
    page: title,
    prop: "text|links|revid",
    redirects: "1",
  });
  if (!parsed.parse) throw new Error(`Could not parse ${lang}:${title}.`);
  return parsed.parse;
}

/**
 * Article-namespace links, in the order they appear in the article.
 *
 * Read off the cleaned tree rather than from `action=parse&prop=links`. The
 * API's list is every link on the rendered page, including ones inside navboxes,
 * authority-control templates and citation footnotes — chrome this parser
 * deliberately removes from the text. Using it made the coverage diff disagree
 * with the columns it sits beneath: it reported "Virtual International Authority
 * File", "WorldCat" and "Ynet" as concepts a version uniquely covered, when they
 * were artefacts of which citation and metadata templates that language edition
 * happens to use.
 *
 * Reading the tree also gives a usable ordering. Position is a rough proxy for
 * prominence — a concept linked from the lead outranks one linked from the last
 * section — which is what breaks ties in `coverageDiff` once the limit bites.
 */
export function linkTitlesOf(page: ParsedPage): string[] {
  const root = parse(page.text);
  removeChrome(root);
  const container = root.querySelector(".mw-parser-output") ?? root;

  const seen = new Set<string>();
  const out: string[] = [];

  for (const anchor of container.querySelectorAll("a")) {
    if (out.length >= MAX_LINKS) break;

    // Red links carry class="new" and point at an edit form.
    if ((anchor.getAttribute("class") ?? "").split(/\s+/).includes("new")) continue;

    const match = /^(?:\.\/|\/wiki\/)([^#?]+)/.exec(anchor.getAttribute("href") ?? "");
    if (!match) continue;

    let title: string;
    try {
      title = decodeURIComponent(match[1]).replace(/_/g, " ");
    } catch {
      continue; // malformed percent-encoding
    }

    // A colon means a non-article namespace: File:, Category:, Help:, Special:.
    if (!title || title.includes(":") || seen.has(title)) continue;
    seen.add(title);
    out.push(title);
  }

  return out;
}

export function snapshotOf(
  lang: Lang,
  page: ParsedPage,
  linkQids: string[],
  qidByTitle?: Map<string, string>,
): ArticleSnapshot {
  return {
    lang,
    title: page.title,
    revid: page.revid,
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`,
    sections: splitSections(page.text, qidByTitle),
    image: extractLeadImage(page.text, lang),
    linkQids,
  };
}

export async function fetchArticle(lang: Lang, title: string): Promise<ArticleSnapshot> {
  const page = await fetchParsedPage(lang, title);
  const qidMap = await titlesToQids(lang, linkTitlesOf(page));
  const snapshot = snapshotOf(lang, page, [...new Set(qidMap.values())], qidMap);
  // The credit lookup lives out here rather than in `snapshotOf` because
  // `snapshotOf` is also how fixtures replay, offline, with no API to ask. A
  // snapshot reaching the database has been through this line; one reconstructed
  // from a fixture has not, and shows its photo uncredited in development only.
  if (snapshot.image) snapshot.image = await withImageCredit(snapshot.image);
  return snapshot;
}

export { titlesToQids };

export async function fetchLabels(qids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < qids.length; i += 50) {
    const batch = qids.slice(i, i + 50);
    try {
      const res = await api<{ entities?: Record<string, { labels?: Record<string, { value: string }> }> }>(WIKIDATA, {
        action: "wbgetentities",
        ids: batch.join("|"),
        props: "labels",
        languages: "en",
      });
      for (const [qid, entity] of Object.entries(res.entities ?? {})) {
        const label = entity.labels?.en?.value;
        if (label) out.set(qid, label);
      }
    } catch {
      // Same as above: labels are a nicety.
    }
  }
  return out;
}
