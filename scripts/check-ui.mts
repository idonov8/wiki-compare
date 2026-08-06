/**
 * Rendering checks against a running dev server, using a recorded fixture.
 *
 *   npm run dev                # in one shell
 *   npm run check:ui           # in another
 *
 * The load-bearing assertion is that a highlight never breaks visually at a
 * direction boundary. Marks legitimately fragment into many client rects when
 * they straddle a bidi run — the Hebrew span containing "42.9%" produces
 * fourteen across three lines — so counting rects proves nothing. What matters
 * is whether two rects on the same line fail to touch, which is what a reader
 * would see as a gap in the underline.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const FIXTURE = process.argv[2] ?? "palestinian-legislative-council";

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (ok) console.log(`  ok    ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
};

try {
  await fetch(BASE, { signal: AbortSignal.timeout(3000) });
} catch {
  console.error(`No dev server at ${BASE}. Start one with: npm run dev`);
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? undefined,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });

const pageErrors: string[] = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

// Both stubs stand in for a database. The landing list and the cached badge are
// the only two things the client renders from state it cannot reach through the
// demo fixture path, so they are served here rather than left unchecked.
await page.route("**/api/recent", (route) =>
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      items: [
        {
          qid: "Q1",
          title: `demo:${FIXTURE}`,
          lang: "en",
          langs: ["en", "he", "ar"],
          computedAt: new Date(Date.now() - 3600_000).toISOString(),
        },
        {
          qid: "Q2",
          title: "הדג נחש",
          lang: "he",
          langs: ["he", "ar"],
          computedAt: new Date(Date.now() - 2 * 86400_000).toISOString(),
        },
      ],
    }),
  }),
);

// The comparison the fixture returns, re-served as a two-day-old cached answer
// that two of the three articles have been edited past. Scoped to fixture
// requests: the internal-link check below follows a link to a real article, and
// re-serving that one would put a live fetch behind a route callback that is
// still in flight when the browser closes.
await page.route(
  (url) =>
    url.pathname === "/api/compare" &&
    (url.searchParams.get("title") ?? "").startsWith("demo:"),
  async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...json,
        fromCache: true,
        cache: {
          computedAt: new Date(Date.now() - 2 * 86400_000).toISOString(),
          expiresAt: new Date(Date.now() + 86400_000).toISOString(),
          edited: ["he", "ar"],
        },
      }),
    });
  },
);

console.log(`\n${FIXTURE}`);

// ---- recently cached, before any search ------------------------------------

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".recent li", { timeout: 5000 });

const recent = await page.$$eval(".recent li button", (els) =>
  els.map((el) => {
    const title = el.querySelector(".recent-title") as HTMLElement | null;
    return {
      title: title?.textContent ?? "",
      dir: title?.getAttribute("dir") ?? "",
      langs: el.querySelector(".recent-langs")?.textContent ?? "",
    };
  }),
);
check(recent.length === 2, "recently cached articles list before any search", `${recent.length} rows`);
check(
  recent.some((r) => r.dir === "rtl") && recent.some((r) => r.dir === "ltr"),
  "each row carries its own direction",
  recent.map((r) => `${r.title}=${r.dir}`).join("; "),
);
check(
  recent.every((r) => /^[A-Z]{2}( · [A-Z]{2})*$/.test(r.langs)),
  "rows show which languages were compared",
  recent.map((r) => r.langs).join("; "),
);
check(
  (await page.$$(".recent h2, .recent h3")).length === 0,
  "the list carries no heading of its own",
);

// The list is a history, so a row has to actually open its comparison.
await page.click(".recent li:first-child button");
await page.waitForSelector("mark.claim", { timeout: 30000 });
check(/[?&]title=/.test(page.url()), "clicking a recent article opens it", page.url());

// ---- cached badge -----------------------------------------------------------

check(!!(await page.$(".cached-badge")), "a cached comparison served past an edit is badged");
{
  const tip = await page.$(".cached-tip");
  const hiddenAtRest = await tip?.evaluate((el) => getComputedStyle(el).visibility === "hidden");
  check(!!hiddenAtRest, "its tooltip stays shut until hover");
  await (await page.$(".cached-badge"))!.hover();
  await page.waitForTimeout(200);
  const open = await tip!.evaluate((el) => ({
    visible: getComputedStyle(el).visibility === "visible",
    text: el.textContent ?? "",
    box: el.getBoundingClientRect().toJSON(),
  }));
  check(open.visible, "hovering the badge opens the tooltip");
  check(
    /Hebrew and Arabic have been edited/.test(open.text) && /reused for 3 days/.test(open.text),
    "the tooltip names what changed and how long the cache holds",
    open.text.slice(0, 120),
  );
  const vp = page.viewportSize()!;
  check(
    open.box.x >= 0 && open.box.x + open.box.width <= vp.width,
    "the tooltip stays on screen",
    `x=${Math.round(open.box.x)} w=${Math.round(open.box.width)} vp=${vp.width}`,
  );
  await page.mouse.move(0, 0);
}

// ---- the comparison itself --------------------------------------------------

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.fill('input[aria-label="Article title"]', `demo:${FIXTURE}`);
await page.click("button:has-text('Compare')");
await page.waitForSelector("mark.claim", { timeout: 30000 });

// ---- highlights -------------------------------------------------------------

const marks = await page.evaluate(() => {
  const out: { lang: string; gap: number; rects: number; sample: string }[] = [];
  for (const col of document.querySelectorAll("section.column")) {
    const lang = col.getAttribute("lang") ?? "?";
    for (const mark of col.querySelectorAll("mark.claim")) {
      const rects = [...mark.getClientRects()];
      const lines = new Map<number, DOMRect[]>();
      for (const r of rects) {
        const key = Math.round(r.top / 2) * 2;
        if (!lines.has(key)) lines.set(key, []);
        lines.get(key)!.push(r);
      }
      let gap = 0;
      for (const group of lines.values()) {
        const sorted = [...group].sort((a, b) => a.left - b.left);
        for (let i = 0; i < sorted.length - 1; i++) {
          gap = Math.max(gap, sorted[i + 1].left - sorted[i].right);
        }
      }
      out.push({ lang, gap, rects: rects.length, sample: (mark.textContent ?? "").slice(0, 40) });
    }
  }
  return out;
});

check(marks.length > 0, "highlights render");
const broken = marks.filter((m) => m.gap > 1.5);
check(broken.length === 0, "no highlight breaks at a direction boundary",
  broken.map((m) => `${m.lang}: ${JSON.stringify(m.sample)} gap=${m.gap.toFixed(1)}px`).join("; "));
for (const lang of ["en", "he", "ar"]) {
  const n = marks.filter((m) => m.lang === lang).length;
  if (n) console.log(`        ${lang}: ${n} marks, max intra-line gap ${Math.max(...marks.filter((m) => m.lang === lang).map((m) => m.gap)).toFixed(1)}px`);
}

// ---- lead image + collapsible key facts -------------------------------------

const images = await page.$$eval(".article-image", (els) =>
  els.map((el) => (el as HTMLImageElement).getAttribute("src") ?? ""),
);
check(images.length > 0, "a lead photo renders under the title",
  `${images.length} images`);
check(images.every((src) => /^https:\/\//.test(src)), "photo srcs are absolute https URLs",
  images.join("; "));

const keyFacts = await page.$$eval("details.key-facts", (els) => ({
  count: els.length,
  anyOpen: els.some((el) => (el as HTMLDetailsElement).open),
}));
check(keyFacts.count > 0, "key facts render as a collapsible block");
check(!keyFacts.anyOpen, "key facts default to collapsed");

// Key facts formatted like an infobox: bold labels, and a row that carries a
// difference stays one highlightable unit rather than being split.
const kf = await page.evaluate(() => ({
  labels: document.querySelectorAll(".kf-label").length,
  claimRow: document.querySelectorAll(".kf-row-full mark.claim").length,
}));
check(kf.labels > 0, "key facts use bold label rows", `${kf.labels} labels`);
check(kf.claimRow > 0, "an infobox difference stays highlighted", `${kf.claimRow} rows`);

// ---- internal links + linkable URL ------------------------------------------

check(/[?&]title=/.test(page.url()), "the open article is in the URL", page.url());

const links = await page.$$eval("a.wikilink", (els) =>
  els.map((el) => el.getAttribute("href") ?? ""),
);
check(links.length > 0, "Wikipedia-internal links render as links", `${links.length} links`);
check(
  links.every((href) => /^\/\?title=[^&]+&lang=(en|he|ar)$/.test(href)),
  "internal links point at our own comparison, not Wikipedia",
  links.slice(0, 3).join("; "),
);

// A plain click navigates in place and rewrites the URL.
{
  const before = page.url();
  const first = await page.$("a.wikilink");
  const href = await first!.getAttribute("href");
  await first!.click();
  await page.waitForFunction((u) => location.href !== u, before, { timeout: 5000 }).catch(() => {});
  check(
    page.url().includes(new URL(href!, BASE).search),
    "clicking an internal link opens that article's URL",
    `${before} -> ${page.url()}`,
  );
  await page.goto(`${BASE}/?title=demo:${FIXTURE}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("mark.claim", { timeout: 30000 });
}

// ---- hover card -------------------------------------------------------------

// `:visible` skips marks inside the collapsed Key facts block, which can't be
// hovered until it is opened.
for (const [label, selector] of [
  ["leftmost column", 'section.column[lang="en"] mark.claim:visible'],
  ["rightmost column", 'section.column[lang="ar"] mark.claim:visible'],
] as const) {
  const mark = await page.$(selector);
  if (!mark) continue;
  await mark.scrollIntoViewIfNeeded();
  await mark.hover();
  await page.waitForSelector(".card", { timeout: 5000 });
  const box = (await (await page.$(".card"))!.boundingBox())!;
  const vp = page.viewportSize()!;
  check(
    box.x >= 0 && box.x + box.width <= vp.width && box.y >= 0 && box.y + box.height <= vp.height,
    `hover card stays on screen from the ${label}`,
    `x=${Math.round(box.x)} y=${Math.round(box.y)} w=${Math.round(box.width)} h=${Math.round(box.height)} vp=${vp.width}x${vp.height}`,
  );
  await page.mouse.move(0, 0);
}

// A card near the bottom of the viewport must sit above its mark, not over it.
{
  const placed = await page.evaluate(() => {
    const all = [...document.querySelectorAll("mark.claim")] as HTMLElement[];
    const target = all.find((m) => {
      const r = m.getBoundingClientRect();
      return r.top > window.innerHeight - 260 && r.top < window.innerHeight - 20;
    });
    if (!target) return null;
    target.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
    return target.getBoundingClientRect().top;
  });
  if (placed !== null) {
    await page.waitForTimeout(150);
    const box = await (await page.$(".card"))?.boundingBox();
    if (box) {
      check(box.y + box.height <= placed + 1, "card flips above a mark near the bottom edge",
        `card bottom ${Math.round(box.y + box.height)} vs mark top ${Math.round(placed)}`);
    }
  }
}

// ---- keyboard ---------------------------------------------------------------

await page.keyboard.press("Escape");
const focusable = await page.evaluate(() => {
  const m = [...document.querySelectorAll<HTMLElement>("mark.claim")].find(
    (el) => el.getClientRects().length > 0,
  );
  m?.focus();
  return document.activeElement === m;
});
check(focusable, "keyboard focus reaches a highlight");
check(!!(await page.$(".card")), "focusing a highlight opens the card");
await page.keyboard.press("Escape");
await page.waitForTimeout(150);
check(!(await page.$(".card")), "Escape dismisses the card");

check(pageErrors.length === 0, "no uncaught page errors", pageErrors.join("; "));

// A stub still mid-flight when the browser goes away throws from its callback,
// which lands as an unhandled rejection and takes the exit code with it.
await page.unrouteAll({ behavior: "ignoreErrors" });
await browser.close();
console.log(failures ? `\n${failures} check(s) failed\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
