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
//
// The usage is injected here because the fixture spends nothing, and what a
// cached comparison cost somebody is now the thing the meta strip reports. The
// three shapes are the three a stored row can actually have:
//
//   priced  — a run priced when it ran. Reported exactly.
//   legacy  — token totals and no `costUsd`, which is 13 of the 14 rows in the
//             real database. Priced from the totals and marked an estimate.
//   silent  — nothing usable. Says nothing about cost at all.
type Stored = "priced" | "legacy" | "silent";
let stored: Stored = "priced";
const USAGE: Record<Stored, Record<string, number>> = {
  // 14,203 in and 5,110 out at the diff model's $3/$15 per Mtok is $0.119259,
  // so `legacy` must land on "about $0.12" and never on the exact figure below.
  priced: { inputTokens: 14203, outputTokens: 5110, cachedInputTokens: 0, costUsd: 0.1932 },
  legacy: { inputTokens: 14203, outputTokens: 5110, cachedInputTokens: 0 },
  silent: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
};
await page.route(
  (url) =>
    url.pathname === "/api/compare" &&
    (url.searchParams.get("title") ?? "").startsWith("demo:"),
  async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    const usage = USAGE[stored];
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        ...json,
        usage,
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
// Not ".recent li": that also matches the skeleton rows shown before the
// fetch resolves, which carry no button and would let this race ahead of
// the real list.
await page.waitForSelector(".recent li button", { timeout: 5000 });

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

// ---- meta strip -------------------------------------------------------------

// A cache hit is not free and must never say so: somebody paid to process this
// article and everyone since has read it for nothing, which is the argument the
// whole site rests on. The figure is the one stored with the answer.
const metaSpan = () =>
  page.$eval(".meta > span:first-child", (el) => ({
    text: el.textContent ?? "",
    title: el.getAttribute("title") ?? "",
  }));

const reopen = async (as: Stored) => {
  stored = as;
  await page.goto(`${BASE}/?title=demo:${FIXTURE}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("mark.claim", { timeout: 30000 });
  return metaSpan();
};

{
  const meta = await metaSpan();
  check(
    /\$0\.19 was paid to process this article/.test(meta.text),
    "a cached comparison reports what was paid to process it",
    meta.text,
  );
  check(!/free/i.test(meta.text), "nothing in the strip calls a cached comparison free", meta.text);
  check(
    /14,203 tokens in, 5,110 out/.test(meta.title),
    "the token breakdown stays in the title attribute",
    meta.title,
  );
  check(!/upper bound/.test(meta.title), "a priced run is not hedged as an estimate", meta.title);
}

// The common case, and the one that decides whether any of this was worth
// saying: a row from before costs were recorded still has true token totals, so
// it reports an estimate priced off them. It has to read as an estimate on
// sight — a reader must be able to tell it from the exact figure above without
// a legend — and the title has to admit why and which way it errs.
{
  const meta = await reopen("legacy");
  check(
    /about \$0\.12 was paid to process this article/.test(meta.text),
    "a comparison priced from its tokens says so as an estimate",
    meta.text,
  );
  check(
    !/\$0\.19/.test(meta.text) && !/free/i.test(meta.text),
    "and does not pass the estimate off as the exact figure",
    meta.text,
  );
  check(
    /predates the per-model breakdown/.test(meta.title) && /upper bound/.test(meta.title),
    "the title says why it is approximate and that it errs high",
    meta.title,
  );
}

// The floor: a run with no usable totals knows what it found and not what it
// cost. It says the first without claiming the second — "$0.00" would be the
// same lie the word "free" was, and so would a figure derived from nothing.
{
  const meta = await reopen("silent");
  check(
    /marked/.test(meta.text) && !/\$/.test(meta.text) && !/free/i.test(meta.text),
    "a comparison with no usable totals claims no cost at all",
    meta.text,
  );
  check(!/about/.test(meta.text), "and offers no estimate either", meta.text);
}

await reopen("priced");

// ---- how long each edition is ----------------------------------------------

// The strip's `EN`/`HE`/`AR` boxes are a bar chart now: how much text each
// edition carries, sorted longest first, filled for the columns on screen and
// hollow for the ones that are not. Chart and control are one object, so both
// halves are worth asserting — that the bars are ordered by the thing they
// claim to plot, and that pressing one still lays a column out or takes it
// away. A bar sorted by anything else, or one that stopped answering the
// press, would be decoration sitting where a control used to be.
const bars = () =>
  page.$$eval(".toggle", (els) =>
    els.map((el) => ({
      label: el.getAttribute("aria-label") ?? "",
      on: el.getAttribute("aria-pressed") === "true",
      height: el.querySelector<HTMLElement>(".langbar")!.getBoundingClientRect().height,
    })),
  );
const laidOut = () =>
  page.$$eval("section.column", (els) => els.map((el) => el.getAttribute("lang") ?? "?"));

{
  // The bars plot themselves on arrival, staggered, off a `scaleY` — so a rect
  // measured too early is a frame of the animation rather than the height the
  // bar is claiming. Everything below reads heights, so wait the whole sequence
  // out first: 0.42s of rise behind 0.14s of stagger, plus room to settle.
  await page.waitForTimeout(800);

  const plotted = await bars();
  check(plotted.length === 3, "every edition the article has gets a bar", String(plotted.length));
  check(
    plotted.every((bar, i) => i === 0 || bar.height <= plotted[i - 1].height + 0.5),
    "the bars are sorted longest first",
    plotted.map((bar) => Math.round(bar.height)).join(" ≥ "),
  );
  // The bars carry the comparison; the figure carries the number. A reader on
  // a screen reader gets neither unless the button says so itself.
  check(
    plotted.every((bar) => /, [\d,]+ words$/.test(bar.label)),
    "and each one says its own count in its label",
    plotted[0]?.label,
  );
  check(plotted.every((bar) => bar.on), "every column is on screen to begin with");

  // Pressing the shortest edition takes its column away — and its bar stays,
  // hollow, at the height it always had, since how long the version you just
  // hid is remains the reason to bring it back.
  const shortest = (await bars())[2];
  await (await page.$$(".toggle"))[2].click();
  await page.waitForTimeout(200);
  const after = await bars();
  check(
    (await laidOut()).length === 2,
    "pressing a bar takes its column off the page",
    (await laidOut()).join(", "),
  );
  check(
    !after[2].on && after[2].height === shortest.height,
    "and its bar stays, hollow, at the height it always had",
    `${Math.round(after[2].height)} vs ${Math.round(shortest.height)}`,
  );

  // The last column standing cannot switch itself off: a comparison with
  // nothing in it is not a state the strip is allowed to reach.
  await (await page.$$(".toggle"))[1].click();
  await page.waitForTimeout(200);
  await (await page.$$(".toggle"))[0].click();
  await page.waitForTimeout(200);
  check(
    (await laidOut()).length === 1,
    "the last column on screen refuses to switch itself off",
    (await laidOut()).join(", "),
  );

  await reopen("priced");
}

// ---- cached badge -----------------------------------------------------------

check(!!(await page.$(".cached-badge")), "a cached comparison served past an edit is badged");
{
  const tip = await page.$(".cached-tip");
  const hiddenAtRest = await tip?.evaluate((el) => getComputedStyle(el).visibility === "hidden");
  check(!!hiddenAtRest, "its panel stays shut until hover");
  await (await page.$(".cached-badge"))!.hover();
  await page.waitForTimeout(200);
  const open = await tip!.evaluate((el) => ({
    visible: getComputedStyle(el).visibility === "visible",
    text: el.textContent ?? "",
    box: el.getBoundingClientRect().toJSON(),
  }));
  check(open.visible, "hovering the badge opens the panel");
  // The copy used to state how long the answer keeps being served; it now
  // offers to replace it instead, which is the more useful thing to say once
  // there is a control that actually does it. Assert what it promises now, and
  // that the promise is reachable — a panel offering an update with no working
  // way to update is the failure worth catching here, which is what the click
  // test further down is for.
  check(
    /Hebrew and Arabic have been edited/.test(open.text) && /Donate to update/.test(open.text),
    "the panel names what changed and offers to update it",
    open.text.slice(0, 120),
  );
  // The control that keeps the promise now sits inside the panel, directly under
  // the sentence that makes it — and nowhere else, which is the half of the move
  // that a "does it exist" check on its own would miss.
  check(
    !!(await page.$('.cached-tip button:has-text("Update this article")')),
    "the offer to update carries its control inside the panel",
  );
  check(
    (await page.$$(".meta > button")).length === 0,
    "and no longer beside the badge",
  );
  const vp = page.viewportSize()!;
  check(
    open.box.x >= 0 && open.box.x + open.box.width <= vp.width,
    "the panel stays on screen",
    `x=${Math.round(open.box.x)} w=${Math.round(open.box.width)} vp=${vp.width}`,
  );
  await page.mouse.move(0, 0);

  // Reachable without a pointer: focusing the badge opens the panel, and the
  // next Tab lands on the button inside it.
  const focused = await page.evaluate(() => {
    const badge = document.querySelector<HTMLElement>(".cached-badge");
    badge?.focus();
    return document.activeElement === badge;
  });
  check(focused, "keyboard focus reaches the cached badge");
  check(
    await page.$eval(".cached-tip", (el) => getComputedStyle(el).visibility === "visible"),
    "focusing the badge opens the panel",
  );
  await page.keyboard.press("Tab");
  const tabbed = await page.evaluate(() => document.activeElement?.className ?? "");
  check(tabbed.includes("cached-update"), "Tab reaches the update button inside it", tabbed);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(200);
  check(
    await page.$eval(".cached-tip", (el) => getComputedStyle(el).visibility === "hidden"),
    "the panel shuts again once focus leaves",
  );

  // The trap this whole arrangement exists to avoid: a button inside a hover
  // panel that the pointer can never reach, because the panel closes somewhere
  // between the badge and the button. So travel the actual distance with the
  // actual mouse and press the actual button. Signed out it goes to the donate
  // page, which is stubbed here — the click registering is what is under test,
  // not whatever that page renders.
  await page.route("**/donate*", (route) =>
    route.fulfill({ contentType: "text/html", body: "<html><body>donate</body></html>" }),
  );
  {
    await (await page.$(".cached-badge"))!.hover();
    await page.waitForTimeout(150);
    const box = (await (await page.$(".cached-tip button"))!.boundingBox())!;
    // In steps, so the pointer crosses the gap between badge and panel rather
    // than teleporting over it.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
    const live = await page.$eval(".cached-tip", (el) => {
      const s = getComputedStyle(el);
      return { visible: s.visibility === "visible", clickable: s.pointerEvents !== "none" };
    });
    check(live.visible, "the panel survives the trip from badge to button");
    check(live.clickable, "and takes pointer events while it is open");
    await page.mouse.down();
    await page.mouse.up();
    await page
      .waitForFunction(() => location.pathname === "/donate", null, { timeout: 5000 })
      .catch(() => {});
    check(
      /\/donate\?from=stale-badge/.test(page.url()),
      "clicking the button inside the panel registers",
      page.url(),
    );
  }
  await page.unroute("**/donate*");
  await page.mouse.move(0, 0);
}

// ---- the comparison itself --------------------------------------------------

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.fill('input[aria-label="Article title"]', `demo:${FIXTURE}`);
// `demo:` skips the search-and-confirm flow and compares the fixture directly.
await page.click("button:has-text('Search')");
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

// ---- one language at a time, on a phone ------------------------------------

// Below the `cols` breakpoint the three columns cannot sit side by side, so the
// page shows one and the reader moves between them two ways: the floating
// switch, and a swipe over the article. The assertion worth having is that those
// two are one state — a swipe that moved the column without moving the switch
// would leave the control lying about what is on screen.
{
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const small = await phone.newPage();
  small.on("pageerror", (e) => pageErrors.push(e.message));
  await small.goto(`${BASE}/?title=demo:${FIXTURE}`, { waitUntil: "domcontentloaded" });
  await small.waitForSelector("mark.claim", { timeout: 30000 });

  const columns = () =>
    small.$$eval("section.column", (els) => els.map((el) => el.getAttribute("lang") ?? "?"));
  const pressed = () =>
    small.$eval(".langswitch [aria-pressed=true]", (el) => el.getAttribute("lang") ?? "?");

  check((await columns()).length === 1, "one column at a time on a narrow screen",
    (await columns()).join(", "));
  check(
    (await small.$$(".langswitch-option")).length === 3,
    "the floating switch offers every language the article has",
  );
  check((await columns())[0] === (await pressed()), "and marks the one on screen",
    `${(await columns())[0]} vs ${await pressed()}`);
  // The length chart stays, because how long the two editions you are not
  // reading are is a question a one-column screen very much has — it is the
  // only place that screen can be told. What it means by a filled bar narrows
  // to fit: a wide screen sets several editions beside each other, a phone
  // reads one, and "on screen" is still the sentence either way. So exactly one
  // bar is filled here, and it is the column being read.
  const charted = () =>
    small.$eval(".toggles [aria-pressed=true]", (el) => el.textContent?.slice(-2) ?? "?");
  check(
    (await small.$$(".toggle")).length === 3,
    "the length chart still plots all three editions on a phone",
  );
  check(
    (await small.$$(".toggles [aria-pressed=true]")).length === 1,
    "with one bar filled, since one column is what a phone shows",
  );
  check(
    (await charted()).toLowerCase() === (await columns())[0],
    "and it is the column on screen",
    `${await charted()} vs ${(await columns())[0]}`,
  );

  // Pressing a language brings it up — from the pill under the thumb, or from
  // the chart at the top of the page, which are the same state written twice
  // more.
  await small.click('.langswitch-option[lang="ar"]');
  await small.waitForTimeout(350);
  check((await columns())[0] === "ar", "pressing a language on the switch opens it",
    (await columns()).join(", "));
  check((await charted()).toLowerCase() === "ar", "and the chart follows it", await charted());

  await small.click('.toggle[aria-label^="Hebrew"]');
  await small.waitForTimeout(350);
  check((await columns())[0] === "he", "pressing a bar in the chart opens that language",
    (await columns()).join(", "));
  check((await pressed()) === "he", "and the pill follows it", await pressed());

  await small.click('.langswitch-option[lang="ar"]');
  await small.waitForTimeout(350);

  // And so does a flick across the article — landing on the neighbouring
  // language, with the switch following it rather than being left behind. The
  // gesture is dispatched rather than driven through `page.touchscreen`, which
  // only taps. Nothing inside these callbacks is factored into a helper: they
  // are compiled into the page by esbuild, whose `keepNames` wraps a named
  // function expression in a `__name` that does not exist in the browser.
  const swipe = (dx: number, dy: number) =>
    small.evaluate(([deltaX, deltaY]) => {
      const target = document.querySelector("section.column")!;
      const from = new Touch({ identifier: 1, target, clientX: 200, clientY: 600 });
      const to = new Touch({
        identifier: 1,
        target,
        clientX: 200 + deltaX,
        clientY: 600 + deltaY,
      });
      target.dispatchEvent(
        new TouchEvent("touchstart", { bubbles: true, touches: [from], changedTouches: [from] }),
      );
      target.dispatchEvent(
        new TouchEvent("touchmove", { bubbles: true, touches: [to], changedTouches: [to] }),
      );
      target.dispatchEvent(
        new TouchEvent("touchend", { bubbles: true, touches: [], changedTouches: [to] }),
      );
    }, [dx, dy]);

  await swipe(160, 0); // rightwards: pull the previous language back in
  await small.waitForTimeout(350);
  check((await columns())[0] === "he", "swiping across the article changes language",
    (await columns()).join(", "));
  check((await pressed()) === "he", "and the floating switch follows the swipe",
    await pressed());

  // A drag mostly down the page is a scroll, whatever sideways drift it picked
  // up on the way — mistaking one for the other would make the article
  // unreadable one-handed.
  await swipe(60, -400);
  await small.waitForTimeout(350);
  check((await columns())[0] === "he", "a scroll with sideways drift is not a swipe",
    (await columns()).join(", "));

  // The two floating controls and the last line of the article all want the
  // bottom of the screen, and the switch is what has to stay reachable.
  const overlap = await small.evaluate(() => {
    const a = document.querySelector(".langswitch")?.getBoundingClientRect();
    const b = document.querySelector(".diffnav-controls")?.getBoundingClientRect();
    if (!a || !b) return null;
    return !(a.right < b.left || b.right < a.left || a.bottom < b.top || b.bottom < a.top);
  });
  check(overlap === false, "the switch and the difference stepper do not overlap");

  const clear = await small.evaluate(() => {
    const el = document.querySelector(".langswitch")!;
    const r = el.getBoundingClientRect();
    // Whatever is painted at the switch's own centre has to be the switch.
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return el.contains(hit);
  });
  check(clear, "and nothing is covering the switch");

  await phone.close();
}

check(pageErrors.length === 0, "no uncaught page errors", pageErrors.join("; "));

// A stub still mid-flight when the browser goes away throws from its callback,
// which lands as an unhandled rejection and takes the exit code with it.
await page.unrouteAll({ behavior: "ignoreErrors" });
await browser.close();
console.log(failures ? `\n${failures} check(s) failed\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
