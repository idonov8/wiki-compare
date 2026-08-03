/**
 * Record real MediaWiki responses into fixtures/ so the pipeline can be tested
 * without hammering Wikipedia.
 *
 *   npx tsx scripts/save-fixture.mts "Palestinian Legislative Council"
 *   npm run fixtures:refresh          # re-record every fixture already on disk
 *
 * In a proxied environment Node's built-in fetch ignores HTTPS_PROXY; prefix
 * with NODE_USE_ENV_PROXY=1 if requests are rejected.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchLabels,
  fetchParsedPage,
  linkTitlesOf,
  resolveSitelinks,
  titlesToQids,
} from "../lib/wikipedia";
import type { Lang } from "../lib/types";
import type { Fixture } from "../fixtures/loader";
import { listFixtures, loadFixture } from "../fixtures/loader";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

async function record(query: string): Promise<void> {
  const { qid, titles } = await resolveSitelinks(query, "en");
  const langs = Object.keys(titles) as Lang[];
  console.log(`\n${query}  ->  ${qid}  [${langs.join(", ")}]`);

  const pages: Fixture["pages"] = {};
  const linkQids: Fixture["linkQids"] = {};

  for (const lang of langs) {
    const page = await fetchParsedPage(lang, titles[lang]!);
    const qidMap = await titlesToQids(lang, linkTitlesOf(page));
    pages[lang] = page;
    linkQids[lang] = [...new Set(qidMap.values())];
    console.log(`  ${lang}: rev=${page.revid} html=${page.text.length}ch qids=${linkQids[lang]!.length}`);
  }

  const allQids = [...new Set(Object.values(linkQids).flat())];
  const labels = await fetchLabels(allQids);
  console.log(`  labels: ${labels.size}/${allQids.length}`);

  const fixture: Fixture = {
    slug: slugify(query),
    query,
    qid,
    capturedAt: new Date().toISOString(),
    titles,
    pages,
    linkQids,
    labels: Object.fromEntries(labels),
  };

  const path = join(DIR, `${fixture.slug}.json`);
  writeFileSync(path, `${JSON.stringify(fixture, null, 1)}\n`);
  console.log(`  wrote ${path}`);
}

const args = process.argv.slice(2);
const queries = args.length
  ? args
  : listFixtures().map((slug) => loadFixture(slug).query);

if (!queries.length) {
  console.error('Usage: npx tsx scripts/save-fixture.mts "Article title" [...]');
  process.exit(1);
}

for (const q of queries) await record(q);
