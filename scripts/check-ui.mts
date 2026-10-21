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
import { chromium, type Route } from "playwright";

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
          words: { en: 8400, he: 4200, ar: 800 },
          claims: { contradiction: 4, unique: 3, framing: 2 },
        },
        {
          qid: "Q2",
          title: "הדג נחש",
          lang: "he",
          langs: ["he", "ar"],
          computedAt: new Date(Date.now() - 2 * 86400_000).toISOString(),
          words: { he: 900, ar: 1500 },
          claims: { contradiction: 2, unique: 1, framing: 0 },
        },
        {
          qid: "Q3",
          title: "Rothschild Boulevard",
          lang: "en",
          langs: ["en", "he"],
          computedAt: new Date(Date.now() - 5 * 86400_000).toISOString(),
          words: { en: 2000, he: 3000 },
          claims: { contradiction: 0, unique: 0, framing: 0 },
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
// cached comparison cost is the thing the meta strip reports. The three shapes
// are the three a stored row can actually have:
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
/** The interception, kept addressable: the phone contexts further down mount it
 *  too, since the strip they check is the one a cached answer draws. */
const isFixtureCompare = (url: URL) =>
  url.pathname === "/api/compare" && (url.searchParams.get("title") ?? "").startsWith("demo:");

const serveCached = async (route: Route) => {
  const response = await route.fetch();
  const body = await response.text();
  const usage = USAGE[stored];
  const cache = {
    computedAt: new Date(Date.now() - 2 * 86400_000).toISOString(),
    edited: ["he", "ar"],
  };

  // The client asks for a stream, so the fixture answers as one: a `done`
  // line carrying the result. Re-wrapped rather than passed through, because
  // what this interception exists to do is substitute the usage figures.
  const streamed = new URL(route.request().url()).searchParams.get("stream") === "1";
  if (streamed) {
    const done = body
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .find((event) => event.event === "done");
    route.fulfill({
      contentType: "application/x-ndjson",
      body:
        JSON.stringify({
          event: "done",
          result: { ...done.result, usage },
          fromCache: true,
          cache,
        }) + "\n",
    });
    return;
  }

  const json = JSON.parse(body);
  route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ ...json, usage, fromCache: true, cache }),
  });
};
await page.route(isFixtureCompare, serveCached);

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
    };
  }),
);
check(recent.length === 3, "recently cached articles list before any search", `${recent.length} rows`);
check(
  recent.some((r) => r.dir === "rtl") && recent.some((r) => r.dir === "ltr"),
  "each row carries its own direction",
  recent.map((r) => `${r.title}=${r.dir}`).join("; "),
);
check(
  (await page.$$(".recent h2, .recent h3")).length === 0,
  "the list carries no heading of its own",
);

// The two marks that replaced the cached-at timestamp. A bar per edition that
// exists, scaled within its own row, and one line divided between the kinds of
// difference found — so a row with none draws an empty track and no segments.
// The marks plot themselves off a transform, staggered down the rows, so a rect
// measured too early is a frame of the animation rather than the height the bar
// is claiming: wait the sequence out before reading any of them.
await page.waitForTimeout(1000);
const charts = await page.$$eval(".recent li button", (els) =>
  els.map((el) => ({
    bars: [...el.querySelectorAll(".recent-bars > span")].map(
      (bar) => (bar as HTMLElement).getBoundingClientRect().height,
    ),
    codes: (el.querySelector(".recent-words")?.textContent ?? "").trim(),
    segments: el.querySelectorAll(".recent-ratio > span").length,
    words: el.querySelector(".recent-words")?.getAttribute("title") ?? "",
    ratio: el.querySelector(".recent-ratio")?.getAttribute("title") ?? "",
  })),
);
check(
  charts[0].bars.length === 3 && charts[0].bars[0] > charts[0].bars[1] && charts[0].bars[1] > charts[0].bars[2],
  "each row charts its editions' word counts in en·he·ar order",
  charts.map((c) => c.bars.join("/")).join("; "),
);
check(
  charts[1].bars[0] <= 1 && charts[1].bars[2] > charts[1].bars[1],
  "an edition the subject does not have draws a stub, not a bar",
  charts[1].bars.join("/"),
);
check(
  charts.every((c) => c.codes === "enhear"),
  "and names the edition each bar stands for, in that order",
  charts.map((c) => c.codes).join("; "),
);
check(
  charts[0].segments === 3 && charts[2].segments === 0,
  "the difference line carries one segment per kind found, and none when there were none",
  charts.map((c) => `${c.segments}`).join("; "),
);
check(
  /English 8,400 words/.test(charts[0].words) && /4 contradictions/.test(charts[0].ratio),
  "both marks name their exact figures on hover",
  `${charts[0].words} | ${charts[0].ratio}`,
);
check(
  /no differences found/.test(charts[2].ratio),
  "a full run that found nothing says so rather than showing an unexplained empty line",
  charts[2].ratio,
);

// The list is a history, so a row has to actually open its comparison.
await page.click(".recent li:first-child button");
await page.waitForSelector("mark.claim", { timeout: 30000 });
check(/[?&]title=/.test(page.url()), "clicking a recent article opens it", page.url());

// ---- meta strip -------------------------------------------------------------

// A cache hit is not free and must never say so: processing this article cost
// real money once, and everyone since has read it for nothing. The figure is the
// one stored with the answer.
const metaSpan = () => page.$eval(".meta-cost", (el) => el.textContent ?? "");

const reopen = async (as: Stored) => {
  stored = as;
  await page.goto(`${BASE}/?title=demo:${FIXTURE}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("mark.claim", { timeout: 30000 });
};

{
  const meta = await metaSpan();
  check(
    /\$0\.19 was paid to process this article/.test(meta),
    "a cached comparison reports what was paid to process it",
    meta,
  );
  check(!/free/i.test(meta), "nothing in the strip calls a cached comparison free", meta);
  check(
    (await page.$eval(".meta-cost", (el) => el.getAttribute("title"))) === null,
    "the processing cost carries no title attribute",
  );
  check(
    (await page.$$eval(".controls [title]", (els) =>
      els.some((el) => /tokens/i.test(el.getAttribute("title") ?? "")),
    )) === false,
    "the strip carries no token breakdown title",
  );
  check(
    /contradiction/i.test(
      (await page.$eval(".controls .recent-ratio", (el) => el.getAttribute("title") ?? "")),
    ),
    "the ratio title reports the claim counts",
  );
  const processedRatio = await page.$eval(".controls .recent-ratio", (el) =>
    [...el.children].map((child) => [...child.classList].find((name) => name.startsWith("bg-")) ?? ""),
  );
  check(
    processedRatio.length === 3 &&
      new Set(processedRatio).size === 3 &&
      ["bg-contradiction", "bg-unique", "bg-framing"].every((kind) => processedRatio.includes(kind)),
    "a processed strip draws one colored segment per claim kind present",
    processedRatio.join(", "),
  );
  check(
    !!(await page.$(".controls .recent-ratio")) && !/marked/i.test((await page.textContent(".controls")) ?? ""),
    "the processed strip shows the ratio rather than a marked count",
    (await page.textContent(".controls")) ?? "",
  );
}

// The common case, and the one that decides whether any of this was worth
// saying: a row from before costs were recorded still has true token totals, so
// it reports an estimate priced off them. It has to read as an estimate on
// sight — a reader must be able to tell it from the exact figure above without
// a legend.
{
  await reopen("legacy");
  const meta = await metaSpan();
  check(
    /about \$0\.12 was paid to process this article/.test(meta),
    "a comparison priced from its tokens says so as an estimate",
    meta,
  );
  check(
    !/\$0\.19/.test(meta) && !/free/i.test(meta),
    "and does not pass the estimate off as the exact figure",
    meta,
  );
}

// The floor: a run with no usable totals knows what it found and not what it
// cost. It says the first without claiming the second — "$0.00" would be the
// same lie the word "free" was, and so would a figure derived from nothing.
{
  await reopen("silent");
  const meta = (await page.textContent(".controls")) ?? "";
  check(
    (await page.$(".meta-cost")) === null && !!(await page.$(".controls .recent-ratio")),
    "a comparison with no usable totals still draws its ratio without a cost line",
    meta,
  );
  check(!/\$|free|about/i.test(meta), "and offers no cost, free, or estimate text", meta);
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
  check(
    /Hebrew and Arabic have been edited/.test(open.text),
    "the panel names what changed",
    open.text.slice(0, 120),
  );
  check(!(await page.$(".cached-tip button")), "and offers no control, since nothing can be re-read on request");
  const vp = page.viewportSize()!;
  check(
    open.box.x >= 0 && open.box.x + open.box.width <= vp.width,
    "the panel stays on screen",
    `x=${Math.round(open.box.x)} w=${Math.round(open.box.width)} vp=${vp.width}`,
  );
  await page.mouse.move(0, 0);

  // Reachable without a pointer: focusing the badge opens the panel.
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
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(200);
  check(
    await page.$eval(".cached-tip", (el) => getComputedStyle(el).visibility === "hidden"),
    "the panel shuts again once focus leaves",
  );

  // A hover panel the pointer can never reach, because it closes somewhere
  // between the badge and the panel, would be unreadable. So travel the actual
  // distance with the actual mouse.
  {
    await (await page.$(".cached-badge"))!.hover();
    await page.waitForTimeout(150);
    const box = (await (await page.$("#cached-note"))!.boundingBox())!;
    // In steps, so the pointer crosses the gap between badge and panel rather
    // than teleporting over it.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
    const live = await page.$eval(".cached-tip", (el) => {
      const s = getComputedStyle(el);
      return { visible: s.visibility === "visible", clickable: s.pointerEvents !== "none" };
    });
    check(live.visible, "the panel survives the trip from badge to panel");
    check(live.clickable, "and takes pointer events while it is open");
  }
  await page.mouse.move(0, 0);
}

// ---- the comparison itself --------------------------------------------------

await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle");
await page.fill('input[aria-label="Article title"]', `demo:${FIXTURE}`);
// `demo:` skips the search-and-confirm flow and compares the fixture directly.
await page.click('button[aria-label="Search"]');
await page.waitForSelector("mark.claim", { timeout: 30000 });

// ---- highlights -------------------------------------------------------------

const marks = await page.evaluate(() => {
  const out: { lang: string; gap: number; rects: number; sample: string }[] = [];
  // Continuation columns too: a mark in the band where one edition runs on alone
  // is set at a width nothing else on the page uses, which is exactly where a
  // span that breaks at a direction boundary would go unnoticed.
  for (const col of document.querySelectorAll("section.column, section.column-more")) {
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

// ---- the page a lopsided set of editions leaves behind ----------------------

// The three articles are never the same length, so the row of columns runs out
// one column at a time — and it used to run out into a page that was a single
// narrow column of Hebrew beside two thirds of nothing, for as long as the
// longest edition kept going. The article is laid out in bands now: each band
// carries only the editions that still have text and shares the whole width
// between them, so the page is spent rather than left blank.
const bands = await page.evaluate(() => {
  const page = document.querySelector<HTMLElement>(".columns-flow")!.getBoundingClientRect();
  const unit = document
    .querySelector<HTMLElement>('[data-band="0"] [data-edition]')!
    .getBoundingClientRect().width;
  return [...document.querySelectorAll<HTMLElement>("[data-band]")].map((band) => {
    const cols = [...band.querySelectorAll<HTMLElement>("[data-edition]")];
    const box = band.getBoundingClientRect();
    const ends = cols.filter((col) => col.querySelector(".column-ends"));
    return {
      langs: cols.map((col) => col.getAttribute("data-edition") ?? "?"),
      // As a multiple of a starting column, which is the width the reader met
      // the article at.
      width: cols[0].getBoundingClientRect().width / unit,
      // The widest line this band sets, in pixels — the figure a measure has to
      // be judged in, since a starting column is itself only a third of however
      // wide the window happens to be.
      measure: Math.max(...cols.map((col) => col.getBoundingClientRect().width)),
      margins: [
        Math.round(box.left - page.left),
        Math.round(page.right - box.right),
      ],
      ends: ends.length,
      // What the colophon on an ending column says, flattened.
      said: ends.map((col) => col.querySelector(".column-ends")!.textContent ?? ""),
      rule: ends.map((col) =>
        parseFloat(getComputedStyle(col.querySelector(".column-ends")!).borderTopWidth),
      ),
    };
  });
});

check(bands.length > 1, "a lopsided article is laid out in bands, not one row of columns",
  `${bands.length} band(s)`);
check(
  bands.every((band, i) => i === 0 || band.langs.length < bands[i - 1].langs.length),
  "each band carries fewer editions than the one above it",
  bands.map((b) => b.langs.join("+")).join(" → "),
);
// The point of the whole arrangement: the width an edition gives up when it ends
// goes to the ones still running, rather than to the margin.
check(
  bands.every((band, i) => i === 0 || band.width > bands[i - 1].width + 0.1),
  "and the editions still running take the width the finished ones gave up",
  bands.map((b) => `${b.width.toFixed(2)}×`).join(" → "),
);
// Reclaiming the width must not cost the line length. One edition across a
// 1440px window is a 150-character line, so the last one standing stops at the
// measure Wikipedia sets an article at and lets the paper show either side —
// which is also the page a reader arriving from the source article knows.
const solo = bands[bands.length - 1];
check(
  bands.every((band) => band.measure <= 1000),
  "no band sets a line wider than a Wikipedia article's own measure",
  bands.map((b) => `${Math.round(b.measure)}px`).join(", "),
);
check(
  solo.langs.length > 1 || (solo.margins[0] > 40 && solo.margins[0] === solo.margins[1]),
  "the last edition standing sits in a page of its own, margins either side",
  `${solo.langs.join("+")} at ${solo.margins.join(" / ")}`,
);
// An edition that simply stopped beside one that did not would read as text we
// had dropped, so the ending is the one thing here still written out — as a
// colophon, on a rule in full ink, naming the edition in its own script.
check(
  bands.slice(0, -1).every((band, i) => band.ends === band.langs.length - bands[i + 1].langs.length),
  "every edition that stops says where it ended",
  bands.map((b) => `${b.ends} of ${b.langs.length}`).join("; "),
);
check(
  bands.every((band) =>
    band.said.every((said, i) => /end of the \w+ article/i.test(said) && band.rule[i] >= 2),
  ),
  "and says it as a colophon, named and ruled off",
  bands.flatMap((b) => b.said).join(" | "),
);
// A band drops languages and never takes one back: an edition that ended two
// bands ago reappearing below would mean the article was being re-ordered.
check(
  bands.every((band, i) => i === 0 || band.langs.every((l) => bands[i - 1].langs.includes(l))),
  "no edition comes back after it has ended",
  bands.map((b) => b.langs.join("+")).join(" → "),
);

// The change of shape is drawn rather than written: every rule the band above
// stands on travels, across one joint, to where the band below stands it. That
// only says anything if the curves actually arrive at the rules — a bend landing
// two hundred pixels from the seam it is supposed to be explaining is a squiggle.
// So the paths are read back and their feet compared against where the columns
// below really are.
const joints = await page.evaluate(() => {
  return [...document.querySelectorAll<SVGSVGElement>("svg.bend")].map((svg) => {
    const box = svg.getBoundingClientRect();
    const span = Number(svg.getAttribute("viewBox")!.split(" ")[2]);
    const feet = [...svg.querySelectorAll("path[stroke]")].map((path) => {
      const [, x] = path.getAttribute("d")!.match(/([\d.]+) 100$/)!;
      return box.left + (Number(x) / span) * box.width;
    });
    const cols = [...svg.nextElementSibling!.querySelectorAll<HTMLElement>("[data-edition]")];
    const rules = cols.map((col) => col.getBoundingClientRect().left);
    rules.push(cols[cols.length - 1].getBoundingClientRect().right);
    return {
      feet,
      // The furthest any curve lands from the nearest rule below it.
      drift: Math.max(
        ...feet.map((foot) => Math.min(...rules.map((rule) => Math.abs(foot - rule)))),
      ),
    };
  });
});
check(joints.length === bands.length - 1, "a bend is drawn at every change of shape",
  `${joints.length} for ${bands.length} bands`);
check(
  joints.every((joint) => joint.feet.length > 0 && joint.drift <= 1.5),
  "and every rule it carries lands on a rule of the band below",
  joints.map((j) => `${j.feet.length} rules, ${j.drift.toFixed(1)}px off`).join("; "),
);

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

// ---- the sources, and the blindspots in them -------------------------------

// Which sources a version shares with the others is arithmetic done on the
// server; what this checks is that the arithmetic reaches the page as badges —
// and only as badges, since an entry set differently for being shared reads as
// a source that counts for less — and that pressing "highlight blindspots"
// marks exactly the entries the other versions cite and this one does not. The
// payload is stubbed rather than parsed out of the fixture, because no fixture
// article shares a source across all three languages, which is the badge most
// worth checking.
{
  const entry = (i: number, citedIn: string[], title: string, domain: string) => ({
    text: `${title} — citation line`,
    title,
    url: `https://${domain}/${i}`,
    domain,
    group: `g${i}`,
    citedIn,
  });
  const sources = {
    langs: ["en", "he", "ar"],
    sources: {
      en: [
        entry(1, ["en"], "Only English read this", "cfr.org"),
        entry(2, ["en", "he"], "English and Hebrew read this", "haaretz.co.il"),
        entry(3, ["en", "he", "ar"], "All three read this", "bbc.com"),
      ],
      he: [
        entry(2, ["en", "he"], "אנגלית ועברית קראו את זה", "haaretz.co.il"),
        entry(3, ["en", "he", "ar"], "שלושתן קראו את זה", "bbc.com"),
        entry(4, ["he"], "רק עברית קראה את זה", "ynet.co.il"),
      ],
      ar: [
        entry(3, ["en", "he", "ar"], "الثلاثة قرأوا هذا", "bbc.com"),
        entry(5, ["ar"], "العربية وحدها قرأت هذا", "wafa.ps"),
      ],
    },
  };
  await page.route("**/api/sources**", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(sources) }),
  );

  await page.goto(`${BASE}/?title=demo:${FIXTURE}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#sources", { timeout: 30000 });
  // The list loads on approach rather than with the article: it is an appendix,
  // and a reader who never scrolls to it should never cause it to be fetched.
  check(
    (await page.$("#sources .source-entry")) === null,
    "the sources are not fetched before the reader is anywhere near them",
  );
  await page.$eval("#sources", (el) => el.scrollIntoView({ block: "start" }));
  await page.waitForSelector("#sources .source-entry", { timeout: 30000 });

  check(
    (await page.$$("#sources .sources-column")).length === 3,
    "one list per language the comparison covered",
  );
  // The rule goes between every pair of columns. Written as a logical border it
  // was drawn on each column's own start edge, which in Hebrew and Arabic is the
  // right — so both of them ruled the same seam and the en|he one had none.
  const ruled = await page.$$eval("#sources .sources-column", (els) =>
    els.map((el) => getComputedStyle(el).borderLeftWidth),
  );
  check(
    ruled[0] === "0px" && ruled.slice(1).every((w) => w !== "0px"),
    "with a rule between every pair of them",
    ruled.join(", "),
  );

  const sized = await page.$$eval("#sources .blindspot-toggle", (els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().width)),
  );

  const shown = (lang: string) =>
    page.$$eval(`[data-sources="${lang}"] .source-entry`, (els) =>
      els.map((el) => ({
        cited: el.getAttribute("data-cited") ?? "",
        badge: el.querySelector(".source-badge")?.textContent ?? null,
        note: el.getAttribute("title"),
        struck: getComputedStyle(el.querySelector(".source-title")!).textDecorationLine,
        weight: Number(getComputedStyle(el.querySelector(".source-title")!).fontWeight),
        faded: Number(getComputedStyle(el).opacity),
      })),
    );

  const en = await shown("en");
  check(en[0].badge === null, "a source only one version cites wears no badge", en[0].badge ?? "");
  check(en[1].badge === "he", "one shared with another version names it", en[1].badge ?? "");
  check(en[2].badge === "he · ar", "one every version cites names both", en[2].badge ?? "");
  check(
    en[1].note === "This source is cited in the English and Hebrew versions.",
    "and says which versions in words, for the hover",
    en[1].note ?? "",
  );
  // The badge is the whole of the difference: a shared source is not set faded,
  // struck through or otherwise as though it were worth less than a unique one.
  check(
    en.every((e) => e.faded === 1 && !e.struck.includes("line-through")),
    "and nothing else about a shared entry is set differently",
    JSON.stringify(en),
  );
  // Except weight, the other way round: the badgeless entries are what a reader
  // is scanning this list for, so they are the ones set a shade heavier.
  check(
    en[0].weight > en[1].weight && en[1].weight === en[2].weight,
    "a source only one version cites is set a shade bolder than the shared ones",
    en.map((e) => e.weight).join(", "),
  );

  // The Hebrew and Arabic lists are the same three states read the other way
  // round, which is what proves the badges are not just the English column's
  // view of itself.
  const he = await shown("he");
  check(he[0].badge === "en", "the Hebrew list names English on the source they share", he[0].badge ?? "");
  check((await shown("ar"))[1].badge === null, "and lists the one only Arabic cites in full ink");

  const marked = () =>
    page.$$eval("#sources .source-entry[data-missing]", (els) =>
      els.map((el) => el.getAttribute("data-cited") ?? ""),
    );

  check((await marked()).length === 0, "nothing is marked until a blindspot is asked for");
  await page.click('[data-sources="en"] .blindspot-toggle');
  // The bands and the fade are a transition; measured on the same tick they are
  // still on their way there.
  await page.waitForTimeout(300);
  check(
    JSON.stringify(await marked()) === JSON.stringify(["he", "ar"]),
    "English's blindspots are exactly the sources the others cite and it does not",
    (await marked()).join(" | "),
  );
  check(
    /^2 sources the other versions cite/.test(
      (await page.textContent('[data-sources="en"] [role="status"]')) ?? "",
    ),
    "and the column counts them",
    (await page.textContent('[data-sources="en"] [role="status"]')) ?? "",
  );
  const dimmed = await page.$$eval('[data-sources="en"] .source-entry', (els) =>
    els.every((el) => Number(getComputedStyle(el).opacity) < 0.5),
  );
  check(dimmed, "while the version doing the asking steps back");

  const resized = await page.$$eval("#sources .blindspot-toggle", (els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().width)),
  );
  check(
    JSON.stringify(resized) === JSON.stringify(sized),
    "and the control it was pressed on is the same size saying Clear",
    `${sized.join(", ")} → ${resized.join(", ")}`,
  );

  await page.click('[data-sources="en"] .blindspot-toggle');
  await page.waitForTimeout(300);
  check((await marked()).length === 0, "and clearing it puts the lists back");

  // The count is an English sentence opening with a numeral, and it sits inside
  // a column that reads right-to-left. Left to inherit that direction, the
  // numeral was reordered to the far end of the line, the full stop landed on
  // the wrong side of it, and the sentence was set flush right. It is English:
  // it reads and is set left-to-right, whichever column it is printed in.
  await page.click('[data-sources="he"] .blindspot-toggle');
  await page.waitForTimeout(300);
  const hebrewNote = await page.$eval('[data-sources="he"] [role="status"]', (el) => ({
    text: el.textContent ?? "",
    direction: getComputedStyle(el).direction,
    align: getComputedStyle(el).textAlign,
  }));
  check(
    /^\d+ sources? the other versions cite/.test(hebrewNote.text.trim()),
    "the blindspot count reads as a sentence in a right-to-left column",
    hebrewNote.text.trim(),
  );
  check(
    hebrewNote.direction === "ltr" && hebrewNote.align === "left",
    "set left-to-right and ragged right, like every other English line here",
    JSON.stringify(hebrewNote),
  );
  await page.click('[data-sources="he"] .blindspot-toggle');
  await page.waitForTimeout(300);

  await page.unroute("**/api/sources**");
}

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

  // The key to the marks goes in the space beside the chart rather than on a
  // line under it. Set as a row on a phone the three kinds wrap into a ragged
  // block and push the strip down a third line, which is a line of the article
  // itself — and the width to the chart's right was sitting empty to pay for
  // it. Beside and stacked is also simply what a key to a chart looks like.
  const key = await small.evaluate(() => {
    const legend = document.querySelector(".legend")!;
    const chart = document.querySelector(".toggles")!.getBoundingClientRect();
    const box = legend.getBoundingClientRect();
    return {
      right: box.left >= chart.right - 1,
      alongside: !(box.bottom < chart.top || chart.bottom < box.top),
      column: getComputedStyle(legend).flexDirection === "column",
    };
  });
  check(key.right && key.alongside, "the legend sits beside the chart, not under it",
    JSON.stringify(key));
  check(key.column, "and stacks its three kinds into a column");

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

  // The sources under the article are one column at a time too, and the same
  // control moves them: a panel still showing three lists under a one-column
  // article would be three columns of the thing the page just decided not to
  // show side by side.
  await small.evaluate(() => document.querySelector("#sources")!.scrollIntoView());
  await small.waitForSelector("#sources .source-entry", { timeout: 30000 });
  const sourced = () =>
    small.$$eval("#sources .sources-column", (els) => els.map((el) => el.getAttribute("lang")));
  check((await sourced()).length === 1, "one list of sources at a time on a phone",
    (await sourced()).join(", "));
  check((await sourced())[0] === (await columns())[0], "the same language the article is in",
    `${(await sourced())[0]} vs ${(await columns())[0]}`);

  await small.click('.langswitch-option[lang="ar"]');
  await small.waitForTimeout(350);
  check((await sourced())[0] === "ar", "and the switch moves both together",
    (await sourced()).join(", "));
  check((await columns())[0] === "ar", "with the article still under the same language",
    (await columns()).join(", "));

  await phone.close();
}

// ---- the strip on a phone, on an answer served past an edit ----------------

// Three items that all want the same row and cannot have it: the length chart,
// the key, and — on a stale answer — the badge. What the strip does about that
// is the whole check here. The line of claim proportions drops to a row of its
// own and runs the width of the page, because squeezed in beside the key it was
// a forty-pixel stub nobody could read a proportion from. The badge does the
// opposite and never takes a row: it ends whichever row it is on, which also
// puts it against the margin the panel below it is measured back from — hung
// off a badge stranded mid-row, that panel opens off the side of the screen.
{
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await phone.route(isFixtureCompare, serveCached);
  const small = await phone.newPage();
  small.on("pageerror", (e) => pageErrors.push(e.message));

  // Every rect the strip's layout is read from, in one pass. Nothing in here is
  // factored into a helper, for the `__name` reason the swipes above give.
  const strip = () =>
    small.evaluate(() => {
      const out: Record<string, { top: number; right: number; bottom: number; width: number }> = {};
      const wanted = [
        ".controls",
        ".legend-key",
        ".controls .recent-ratio",
        ".cached-badge",
        ".meta-cost",
      ];
      for (const selector of wanted) {
        const el = document.querySelector(selector);
        if (el) {
          const box = el.getBoundingClientRect();
          // Width off the layout box rather than the painted one: the claim
          // line is drawn by a scaleX animation, and a rect measured mid-draw
          // reports whatever fraction of itself it had reached.
          out[selector] = {
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            width: (el as HTMLElement).offsetWidth,
          };
        }
      }
      return out;
    });

  // The panel is opened by focus rather than hover, which is the phone's own
  // way in and needs no pointer.
  const panel = async () => {
    await small.$eval(".cached-badge", (el) => (el as HTMLElement).focus());
    await small.waitForTimeout(200);
    const box = await small.$eval(".cached-tip", (el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.x, right: rect.right, visible: getComputedStyle(el).visibility === "visible" };
    });
    await small.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    return box;
  };

  await small.goto(`${BASE}/?title=demo:${FIXTURE}`, { waitUntil: "domcontentloaded" });
  await small.waitForSelector(".cached-badge", { timeout: 30000 });
  await small.waitForTimeout(700);
  {
    const box = await strip();
    const line = box[".controls .recent-ratio"];
    check(
      !!line && line.top >= box[".legend-key"].bottom,
      "the claim line takes a row under the key on a phone, not the gap beside it",
      line ? `line top ${Math.round(line.top)} vs key bottom ${Math.round(box[".legend-key"].bottom)}` : "no line",
    );
    check(
      !!line && line.width >= box[".controls"].width - 36 - 1,
      "and runs the width of the page",
      line ? `${Math.round(line.width)} of ${Math.round(box[".controls"].width)}` : "no line",
    );
    const badge = box[".cached-badge"];
    const cost = box[".meta-cost"];
    check(
      badge.top < cost.bottom && cost.top < badge.bottom,
      "the badge shares the cost line's row rather than wrapping under it",
      `badge ${Math.round(badge.top)}-${Math.round(badge.bottom)} vs cost ${Math.round(cost.top)}-${Math.round(cost.bottom)}`,
    );
    check(
      Math.abs(badge.right - (box[".controls"].right - 18)) <= 1,
      "and ends that row against the page's margin",
      `${Math.round(badge.right)} vs ${Math.round(box[".controls"].right - 18)}`,
    );
    const tip = await panel();
    check(tip.visible, "tapping the badge on a phone opens its panel");
    check(
      tip.x >= 0 && tip.right <= 390,
      "and the panel opens inside the screen",
      `x=${Math.round(tip.x)} right=${Math.round(tip.right)}`,
    );
  }

  await phone.close();
}

// The counterpart panel needs a sentence alignment, which only the Jev engine
// produces: the demo route runs it when the dev server has a TypeSafe key.
{
  console.log("\ncounterpart panel");
  const jev = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await jev.goto(`${BASE}/?title=demo:jev:${FIXTURE}`, { waitUntil: "domcontentloaded" });
  const aligned = await jev
    .waitForSelector("span.sentence", { state: "attached", timeout: 60000 })
    .then(() => true)
    .catch(() => false);
  if (!aligned) {
    console.log("  skip  no sentence alignment (start the dev server with TYPESAFE_API_KEY to check the panel)");
  } else {
    await jev.waitForTimeout(500);
    const sentence = jev.locator('[data-edition="en"] span.sentence').nth(3);
    await sentence.scrollIntoViewIfNeeded();
    await sentence.hover();
    await jev.waitForTimeout(500);
    const passages = jev.locator(".counterpart-passage");
    check((await passages.count()) === 2, "hovering a sentence lays a passage over each other column", `${await passages.count()}`);
    const he = await jev.locator('.counterpart-passage[data-lang="he"]').boundingBox();
    const heColumn = await jev.locator('[data-edition="he"]').first().boundingBox();
    check(
      !!he && !!heColumn && he.x >= heColumn.x - 1 && he.x + he.width <= heColumn.x + heColumn.width + 1,
      "the Hebrew passage sits over the Hebrew column",
      he && heColumn ? `passage ${Math.round(he.x)}..${Math.round(he.x + he.width)}, column ${Math.round(heColumn.x)}..${Math.round(heColumn.x + heColumn.width)}` : "",
    );
    const top = await jev.evaluate((key) => {
      const row = document.querySelector<HTMLElement>(`[data-sentence="${key}"]`);
      return row?.getBoundingClientRect().top ?? 0;
    }, await sentence.getAttribute("data-sentence"));
    check(!!he && he.y <= Math.max(top, 10) + 1, "level with the hovered paragraph, not below it", `passage ${Math.round(he?.y ?? 0)}, sentence ${Math.round(top)}`);
    await jev.mouse.move(2, 2);
    await jev.waitForTimeout(500);
    check(!(await passages.count()), "leaving the sentence closes them");

    await sentence.click();
    await jev.waitForTimeout(300);
    await jev.mouse.move(2, 2);
    await jev.waitForTimeout(500);
    check((await passages.count()) === 2, "a click keeps them open after the pointer leaves");
    await jev.keyboard.press("Escape");
    await jev.waitForTimeout(200);
    check(!(await passages.count()), "and Escape closes them");

    const marked = jev.locator('[data-edition="en"] span.sentence:has(mark.claim)').first();
    await marked.scrollIntoViewIfNeeded();
    await marked.hover();
    await jev.waitForTimeout(500);
    const note = jev.locator(".counterpart-note");
    check(await note.isVisible(), "a marked sentence also gets a card explaining the difference");
    const noteBox = await note.boundingBox();
    const enColumn = await jev.locator('[data-edition="en"]').first().boundingBox();
    check(
      !!noteBox && !!enColumn && noteBox.x >= enColumn.x - 1 && noteBox.x + noteBox.width <= enColumn.x + enColumn.width + 1,
      "in the hovered column",
    );
    await jev.mouse.move(2, 2);
    await jev.waitForTimeout(500);

    const gap = jev.locator('[data-edition="en"] span.sentence:has(mark.claim[data-type="unique"])').first();
    await gap.scrollIntoViewIfNeeded();
    await gap.hover();
    await jev.waitForTimeout(500);
    check(
      (await jev.locator('.counterpart-passage[data-missing="true"]').count()) > 0,
      "a gap marks the passage of the version it is missing from",
    );
    await jev.mouse.move(2, 2);
    await jev.waitForTimeout(500);

    // Low on the screen, everything still has to fit on it.
    const low = jev.locator('[data-edition="en"] span.sentence:has(mark.claim)').nth(4);
    await low.scrollIntoViewIfNeeded();
    const lowBox = (await low.boundingBox())!;
    await jev.evaluate((y) => window.scrollBy(0, y - 800), lowBox.y);
    await jev.waitForTimeout(300);
    await low.hover();
    await jev.waitForTimeout(600);
    const inside = await jev.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".counterpart")].every((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight + 1;
      }),
    );
    check(inside, "near the foot of the screen the card and passages stay on it");
    await jev.mouse.move(2, 2);
    await jev.waitForTimeout(500);

    // Selecting text picks out the matching sentences in the other columns.
    const lead = jev.locator('[data-edition="en"] [data-block]:nth-of-type(3) span.body-text').first();
    await lead.scrollIntoViewIfNeeded();
    const leadBox = (await lead.boundingBox())!;
    await jev.mouse.move(leadBox.x + 3, leadBox.y + 8);
    await jev.mouse.down();
    await jev.mouse.move(leadBox.x + 300, leadBox.y + 60, { steps: 10 });
    await jev.mouse.up();
    await jev.waitForTimeout(500);
    const echoed = await jev.locator('[data-edition="he"] [data-echo="true"], [data-edition="ar"] [data-echo="true"]').count();
    check(echoed > 0, "selecting text highlights the matching sentences in the other languages", `${echoed}`);
    check(!(await jev.locator(".counterpart").count()), "with no passages laid over them");
    await jev.evaluate(() => window.getSelection()?.removeAllRanges());
    await jev.waitForTimeout(300);
    check(!(await jev.locator('[data-echo="true"]').count()), "and clearing the selection clears them");

    const toggle = jev.locator("button.show-all");
    if (await toggle.count()) {
      const before = await jev.locator("mark.claim").count();
      await toggle.click();
      await jev.waitForTimeout(400);
      const after = await jev.locator("mark.claim").count();
      check(after > before, "show all draws the differences the threshold hid", `${before} -> ${after}`);
      await toggle.click();
    }

    const narrow = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await narrow.goto(`${BASE}/?title=demo:jev:${FIXTURE}`, { waitUntil: "domcontentloaded" });
    await narrow.waitForSelector("span.sentence", { state: "attached", timeout: 60000 });
    await narrow.waitForTimeout(500);
    const plainTap = narrow.locator("span.sentence:not(:has(mark.claim))").nth(3);
    await plainTap.scrollIntoViewIfNeeded();
    await plainTap.click();
    await narrow.waitForTimeout(300);
    check(!(await narrow.locator(".counterpart").count()), "on a phone, a sentence with no difference opens nothing");
    const markedTap = narrow.locator("span.sentence:has(mark.claim)").first();
    await markedTap.scrollIntoViewIfNeeded();
    await markedTap.click();
    await narrow.waitForTimeout(300);
    check(
      (await narrow.locator(".counterpart-note").isVisible()) && !(await narrow.locator(".counterpart-passage").count()),
      "and a marked one opens the explanation alone",
    );
    await narrow.close();
  }
  await jev.close();
}

check(pageErrors.length === 0, "no uncaught page errors", pageErrors.join("; "));

// A stub still mid-flight when the browser goes away throws from its callback,
// which lands as an unhandled rejection and takes the exit code with it.
await page.unrouteAll({ behavior: "ignoreErrors" });
await browser.close();
console.log(failures ? `\n${failures} check(s) failed\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
