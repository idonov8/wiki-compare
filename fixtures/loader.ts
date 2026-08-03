import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotOf, type ParsedPage } from "../lib/wikipedia";
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
  /** Resolved once at capture time so replay needs no network. */
  linkQids: Partial<Record<Lang, string[]>>;
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
    out.push(snapshotOf(lang, page, fixture.linkQids[lang] ?? []));
  }
  return out;
}

export function fixtureLabels(fixture: Fixture): Map<string, string> {
  return new Map(Object.entries(fixture.labels));
}
