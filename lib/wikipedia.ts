import type { ArticleSnapshot, Lang, Section } from "./types";
import { LANGS } from "./types";

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

/** Strip the chrome Wikipedia wraps around prose: infoboxes, citations, edit links,
 *  navboxes, reference lists. What survives is what a reader actually reads. */
function stripChrome(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<table\b[\s\S]*?<\/table>/gi, "")
    .replace(/<figure\b[\s\S]*?<\/figure>/gi, "")
    .replace(/<sup\b[^>]*class="[^"]*reference[^"]*"[\s\S]*?<\/sup>/gi, "")
    .replace(/<span\b[^>]*class="[^"]*mw-editsection[^"]*"[\s\S]*?<\/span>/gi, "")
    .replace(/<ol\b[^>]*class="[^"]*references[^"]*"[\s\S]*?<\/ol>/gi, "")
    .replace(/<div\b[^>]*class="[^"]*(navbox|reflist|hatnote|thumb|metadata|ambox|mw-references)[^"]*"[\s\S]*?<\/div>/gi, "");
}

function toText(html: string): string {
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

function splitSections(html: string): Section[] {
  const cleaned = stripChrome(html);
  const sections: Section[] = [];
  const headingRe = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi;

  let cursor = 0;
  let current = { heading: "(lead)", level: 1 };
  let match: RegExpExecArray | null;

  const push = (heading: string, level: number, body: string) => {
    const text = toText(body).slice(0, MAX_SECTION_CHARS);
    if (text.length > 40) sections.push({ heading, level, text });
  };

  while ((match = headingRe.exec(cleaned)) !== null) {
    push(current.heading, current.level, cleaned.slice(cursor, match.index));
    current = { heading: toText(match[2]), level: Number(match[1]) };
    cursor = match.index + match[0].length;
  }
  push(current.heading, current.level, cleaned.slice(cursor));

  return sections.filter((s) => !/^(references|external links|see also|notes|bibliography)$/i.test(s.heading));
}

/** Map article titles to Wikidata QIDs, 50 at a time. */
async function titlesToQids(lang: Lang, titles: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    try {
      const res = await api<{ entities?: Record<string, { id?: string; title?: string; missing?: string }> }>(
        WIKIDATA,
        { action: "wbgetentities", sites: `${lang}wiki`, titles: batch.join("|"), props: "" },
      );
      for (const entity of Object.values(res.entities ?? {})) {
        if (entity.id && entity.title) out.set(entity.title, entity.id);
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
