import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { linkTitlesOf, snapshotOf, type ParsedPage } from "../lib/wikipedia";
import type { ArticleSnapshot, Lang } from "../lib/types";

/**
 * Recorded `action=parse` responses, so the pipeline can be exercised without
 * going back to Wikipedia. The raw HTML is stored rather than parsed sections:
 * the parser is the part most worth testing, so a fixture that stored its
 * output would test nothing.
 */
export interface Fixture {
  slug: string;
  query: string;
  qid: string;
  capturedAt: string;
  titles: Partial<Record<Lang, string>>;
  pages: Partial<Record<Lang, ParsedPage>>;
  /**
   * Wikidata ids keyed by article title, resolved once at capture time so
   * replay needs no network. Keyed by title rather than stored as a flat id
   * list so that a change to which links the parser considers part of the
   * article re-derives correctly from the recorded HTML instead of going stale.
   */
  qidByTitle: Partial<Record<Lang, Record<string, string>>>;
  labels: Record<string, string>;
}

const DIR = dirname(fileURLToPath(import.meta.url));

export function listFixtures(): string[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

export function loadFixture(slug: string): Fixture {
  return JSON.parse(readFileSync(join(DIR, `${slug}.json`), "utf8")) as Fixture;
}

/** Reconstruct snapshots by running the *current* parser over the recorded
 *  HTML, so a parser change shows up here immediately. */
export function fixtureSnapshots(fixture: Fixture): ArticleSnapshot[] {
  const out: ArticleSnapshot[] = [];
  for (const [lang, page] of Object.entries(fixture.pages) as [Lang, ParsedPage][]) {
    const qids = fixture.qidByTitle[lang] ?? {};
    const qidByTitle = new Map(Object.entries(qids));
    const linkQids = [
      ...new Set(
        linkTitlesOf(page)
          .map((title) => qids[title])
          .filter((qid): qid is string => Boolean(qid)),
      ),
    ];
    out.push(snapshotOf(lang, page, linkQids, qidByTitle));
  }
  return out;
}

export function fixtureLabels(fixture: Fixture): Map<string, string> {
  return new Map(Object.entries(fixture.labels));
}
