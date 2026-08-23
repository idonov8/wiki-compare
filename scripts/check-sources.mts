/**
 * Assertions over the source extractor and the cross-language matcher. No
 * network, no model, no database.
 *
 *   npm run check:sources
 *
 * Two halves. The first runs the real reference lists out of the fixtures
 * through the parser, which is where the shape of Wikipedia's markup is
 * checked — template stylesheets, COinS blobs, archive wrappers and the
 * explanatory footnotes that are not sources at all. The second runs made-up
 * pairs through the matcher, which is where the thing that would actually
 * mislead a reader is checked: a strikethrough claims all three versions cite
 * a source, so a false match is a lie on the page and a missed one is only a
 * source listed twice.
 */
import { listFixtures, loadFixture } from "../fixtures/loader";
import { matchSources, parseSources, urlKey } from "../lib/sources";
import type { Lang, Source } from "../lib/types";

let failures = 0;

function check(ok: boolean, label: string, detail = ""): void {
  if (ok) {
    console.log(`    ok    ${label}`);
  } else {
    failures++;
    console.log(`    FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

/** Anything that means the citation's own markup leaked into the line. */
const LEAKED: [string, RegExp][] = [
  ["template stylesheet", /mw-parser-output|\.citation|font-style:/],
  ["COinS metadata", /ctx_ver|rft\.|Z39\.88/],
  ["raw html tag", /<\/?(span|cite|div|style|a)\b/i],
  ["backlink caret", /^\s*\^/],
];

for (const slug of listFixtures()) {
  const fixture = loadFixture(slug);
  console.log(`\n${fixture.query}  (${fixture.qid})`);

  for (const [lang, page] of Object.entries(fixture.pages) as [Lang, { text: string }][]) {
    const sources = parseSources(page.text);
    const footnotes = (page.text.match(/<li id="cite&#95;note|<li id="cite_note/g) ?? []).length;
    console.log(`  ${lang}: ${footnotes} footnotes → ${sources.length} sources`);

    check(sources.length > 0, `${lang} found sources`);
    check(sources.length <= footnotes, `${lang} invented none`, `${sources.length} > ${footnotes}`);
    check(
      sources.every((s) => s.keys.length > 0),
      `${lang} can identify every source it lists`,
    );

    for (const [label, re] of LEAKED) {
      const hit = sources.find((s) => re.test(s.text) || (s.title && re.test(s.title)));
      check(!hit, `${lang} free of ${label}`, hit?.text.slice(0, 60));
    }

    // The Wayback Machine and archive.today, not archive.org at large — that is
    // a digital library plenty of articles cite directly.
    const archived = sources.find(
      (s) => s.url && /web\.archive\.org\/web\/|archive\.(is|ph|today|li|vn|fo)\//.test(s.url),
    );
    check(!archived, `${lang} links the source, not the snapshot`, archived?.url);
  }

  // Whatever the matcher pairs up has to be paired up on both sides: a source
  // the English list says is cited in Hebrew must be in the Hebrew list saying
  // the same about English.
  const byLang: Partial<Record<Lang, Source[]>> = {};
  for (const [lang, page] of Object.entries(fixture.pages) as [Lang, { text: string }][]) {
    byLang[lang] = parseSources(page.text);
  }
  const matched = matchSources(byLang);
  let asymmetric = 0;
  let orphaned = 0;
  for (const lang of matched.langs) {
    const list = matched.sources[lang] ?? [];
    for (const source of list) {
      if (!source.citedIn.includes(lang)) orphaned++;
      for (const other of source.citedIn) {
        const twin = matched.sources[other]?.find((s) => s.group === source.group);
        if (!twin || !twin.citedIn.includes(lang)) asymmetric++;
      }
    }
    const groups = new Set(list.map((s) => s.group));
    check(
      groups.size === list.length,
      `${lang} lists each source once`,
      `${list.length - groups.size} repeats`,
    );
  }
  check(orphaned === 0, "every entry is cited by the language listing it", String(orphaned));
  const shared = matched.langs.flatMap((l) =>
    (matched.sources[l] ?? []).filter((s) => s.citedIn.length > 1),
  );
  console.log(`  matched: ${shared.length} entries cited by more than one version`);
  check(asymmetric === 0, "every match is mutual", `${asymmetric} one-sided`);
}

console.log("\nkeys");

const same = (a: string, b: string, label: string) =>
  check(urlKey(a) !== null && urlKey(a) === urlKey(b), label, `${urlKey(a)} vs ${urlKey(b)}`);
const differ = (a: string, b: string, label: string) =>
  check(urlKey(a) !== urlKey(b), label, `both ${urlKey(a)}`);

same(
  "https://web.archive.org/web/20211005172644/https://www.wafa.ps/ar_page.aspx?id=1t40",
  "https://www.wafa.ps/ar_page.aspx?id=1t40",
  "an archived copy is the page it archived",
);
same(
  "https://www.bbc.com/news/world-middle-east-27660218",
  "https://bbc.com/news/world-middle-east-27660218/",
  "www and a trailing slash are the same address",
);
same(
  "https://nytimes.com/2020/01/01/world/x.html?utm_source=twitter",
  "https://nytimes.com/2020/01/01/world/x.html",
  "a campaign parameter is not part of the address",
);
differ(
  "https://books.google.com/books?id=AAAA",
  "https://books.google.com/books?id=BBBB",
  "two books are not one book",
);
differ(
  "https://haaretz.co.il/news/1",
  "https://haaretz.co.il/news/2",
  "two articles from one paper are two sources",
);
check(urlKey("https://www.ynet.co.il") === null, "a bare domain identifies nothing");
check(urlKey("mailto:someone@example.com") === null, "a mailto identifies nothing");

console.log("\nmatching");

const source = (over: Partial<Source>): Source => ({ text: "x", keys: [], ...over });

{
  const payload = matchSources({
    en: [source({ text: "en-1", keys: ["url:bbc.com/a"] }), source({ text: "en-2", keys: ["isbn:123456789"] })],
    he: [source({ text: "he-1", keys: ["url:bbc.com/a", "title:the same headline twice over"] })],
    ar: [source({ text: "ar-1", keys: ["title:the same headline twice over"] })],
  });
  const en1 = payload.sources.en?.[0];
  const en2 = payload.sources.en?.[1];
  check(en1?.citedIn.join() === "en,he,ar", "a match through a shared key is transitive", en1?.citedIn.join());
  check(en2?.citedIn.join() === "en", "and does not spread to a source sharing nothing", en2?.citedIn.join());
  check(
    payload.sources.ar?.[0]?.group === en1?.group,
    "twins in different languages carry one group id",
  );
}

{
  const payload = matchSources({
    en: [source({ text: "first", keys: ["url:bbc.com/a"] }), source({ text: "second", keys: ["url:bbc.com/a"] })],
  });
  check(payload.sources.en?.length === 1, "one source cited twice is listed once");
  check(payload.sources.en?.[0]?.text === "first", "as the article first printed it");
}

console.log(failures ? `\n${failures} check(s) failed\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
