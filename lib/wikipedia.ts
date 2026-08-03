import { type HTMLElement, type Node, parse } from "node-html-parser";
import type { ArticleSnapshot, Lang, Section } from "./types";
import { KEY_FACTS_HEADING, LANGS, LEAD_HEADING } from "./types";

const UA = "wiki-compare/0.1 (https://github.com/)";
const MAX_SECTION_CHARS = 4000;
const MAX_LINKS = 400;

async function api<T>(endpoint: string, params: Record<string, string>): Promise<T> {
  const url = new URL(endpoint);
  url.search = new URLSearchParams({ format: "json", formatversion: "2", origin: "*", ...params }).toString();
  const res = await fetch(url, { headers: { "User-Agent": UA }, next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`${url.host} returned ${res.status}`);
  return (await res.json()) as T;
}

const wiki = (lang: Lang) => `https://${lang}.wikipedia.org/w/api.php`;
const WIKIDATA = "https://www.wikidata.org/w/api.php";

/** Find the Wikidata item for a title, then the equivalent title in each language. */
export async function resolveSitelinks(
  title: string,
  lang: Lang,
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

export function splitSections(html: string): Section[] {
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
    const text = toText(buffer.join("")).slice(0, MAX_SECTION_CHARS);
    if (text.length > 40 && !isBoilerplate(heading)) sections.push({ heading, level, text });
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
    sections.unshift({ heading: KEY_FACTS_HEADING, level: 1, text: keyFacts.slice(0, MAX_SECTION_CHARS) });
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

export async function fetchArticle(lang: Lang, title: string): Promise<ArticleSnapshot> {
  const parsed = await api<{
    parse?: { title: string; revid: number; text: string; links?: { ns: number; title: string; exists?: boolean }[] };
  }>(wiki(lang), { action: "parse", page: title, prop: "text|links|revid", redirects: "1" });

  const p = parsed.parse;
  if (!p) throw new Error(`Could not parse ${lang}:${title}.`);

  const linkTitles = (p.links ?? [])
    .filter((l) => l.ns === 0 && l.exists !== false)
    .map((l) => l.title)
    .slice(0, MAX_LINKS);

  const qidMap = await titlesToQids(lang, linkTitles);

  return {
    lang,
    title: p.title,
    revid: p.revid,
    url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, "_"))}`,
    sections: splitSections(p.text),
    linkQids: [...new Set(qidMap.values())],
  };
}

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
