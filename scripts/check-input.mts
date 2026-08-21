/**
 * The two pieces of pure logic in front of the pipeline, checked without a
 * network, a model or a database:
 *
 *   - what a pasted Wikipedia URL resolves to, including the ones that aren't one
 *   - that the drifting marks shown while a comparison runs are exact,
 *     non-overlapping substrings of the text they sit in — the same invariant the
 *     real highlighter relies on, and the one that would corrupt an article's
 *     text on screen if it broke
 */
import assert from "node:assert/strict";
import { guessLang, parseWikipediaUrl } from "../lib/wikipedia.js";
import { ghostRanges } from "../lib/ghost.js";
import { isOutOfCredit } from "../lib/compare.js";
import { couponEndLabel, couponExpired } from "../lib/coupons.js";
import { validateFeedback } from "../lib/feedback.js";

let failures = 0;
const check = (label: string, fn: () => void) => {
  try {
    fn();
    console.log(`  ok    ${label}`);
  } catch (error) {
    failures++;
    console.log(`  FAIL  ${label}  (${error instanceof Error ? error.message : error})`);
  }
};

console.log("\nPasted URLs");

check("plain article URL", () =>
  assert.deepEqual(parseWikipediaUrl("https://en.wikipedia.org/wiki/Six-Day_War"), {
    lang: "en",
    title: "Six-Day War",
  }),
);

check("percent-encoded Hebrew title", () =>
  assert.deepEqual(
    parseWikipediaUrl("https://he.wikipedia.org/wiki/%D7%9E%D7%9C%D7%97%D7%9E%D7%AA_%D7%A9%D7%A9%D7%AA_%D7%94%D7%99%D7%9E%D7%99%D7%9D"),
    { lang: "he", title: "מלחמת ששת הימים" },
  ),
);

check("mobile host, fragment and query", () =>
  assert.deepEqual(parseWikipediaUrl("https://ar.m.wikipedia.org/wiki/%D9%82%D9%87%D9%88%D8%A9#tea"), {
    lang: "ar",
    title: "قهوة",
  }),
);

check("index.php?title= form", () =>
  assert.deepEqual(parseWikipediaUrl("https://en.wikipedia.org/w/index.php?title=Coffee&action=history"), {
    lang: "en",
    title: "Coffee",
  }),
);

check("an edition we don't compare still resolves", () =>
  assert.deepEqual(parseWikipediaUrl("https://fr.wikipedia.org/wiki/Caf%C3%A9"), {
    lang: "fr",
    title: "Café",
  }),
);

for (const notAUrl of ["Six-Day War", "https://example.com/wiki/Coffee", "https://en.wikipedia.org/", "wikipedia.org/wiki/Coffee"]) {
  check(`not a URL: ${JSON.stringify(notAUrl)}`, () =>
    assert.equal(parseWikipediaUrl(notAUrl), null),
  );
}

console.log("\nSearch language");
check("Hebrew query searches he", () => assert.equal(guessLang("מלחמת ששת הימים"), "he"));
check("Arabic query searches ar", () => assert.equal(guessLang("قهوة"), "ar"));
check("Latin query searches en", () => assert.equal(guessLang("Six-Day War"), "en"));

console.log("\nDrifting marks");

const SAMPLES = [
  "The Palestinian Legislative Council was the legislature of the Palestinian National Authority, elected in 2006 and effectively suspended since.",
  "המועצה המחוקקת הפלסטינית נבחרה בינואר 2006, ובה זכתה חמאס ב-74 מתוך 132 המושבים.",
  "المجلس التشريعي الفلسطيني هو السلطة التشريعية للسلطة الوطنية الفلسطينية، وقد انتخب عام 2006.",
  "Short text.",
  "",
];

for (const text of SAMPLES) {
  const ranges = ghostRanges(text);
  const label = text ? `${text.slice(0, 24)}…` : "(empty)";

  check(`spans stay inside the text: ${label}`, () => {
    for (const { start, end } of ranges) {
      assert.ok(start >= 0 && end <= text.length && start < end, `bad range ${start}-${end}`);
      const span = text.slice(start, end);
      assert.equal(span.trim(), span, `span has edge whitespace: ${JSON.stringify(span)}`);
    }
  });

  check(`spans never overlap: ${label}`, () => {
    for (let i = 1; i < ranges.length; i++) {
      assert.ok(ranges[i].start > ranges[i - 1].end, `${ranges[i - 1].end} then ${ranges[i].start}`);
    }
  });

  check(`placement is stable across calls: ${label}`, () =>
    assert.deepEqual(ghostRanges(text), ranges),
  );
}

check("a long article section gets marks to animate", () => {
  const long = SAMPLES[0].repeat(6);
  assert.ok(ghostRanges(long).length >= 3);
});

console.log("\nThe site's own balance");

check("Anthropic's empty-balance 400 is recognised", () =>
  assert.equal(
    isOutOfCredit(
      new Error(
        '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit ' +
          'balance is too low to access the Anthropic API. Please go to Plans & Billing to ' +
          'upgrade or purchase credits."},"request_id":"req_1"}',
      ),
    ),
    true,
  ),
);

for (const other of [
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"max_tokens: must be greater than 0"}}',
  "fetch failed",
]) {
  check(`an ordinary failure is not: ${other.slice(0, 32)}…`, () =>
    assert.equal(isOutOfCredit(new Error(other)), false),
  );
}

console.log("\nCoupon deadlines");

check("a code works through the last minute of its final day", () =>
  assert.equal(couponExpired("WELCOME3", new Date("2026-08-26T23:59:59Z")), false),
);

check("and not a minute past it", () =>
  assert.equal(couponExpired("WELCOME3", new Date("2026-08-27T00:00:00Z")), true),
);

check("lower case reaches the same deadline", () =>
  assert.equal(couponExpired(" welcome3 ", new Date("2026-08-27T00:00:00Z")), true),
);

check("a code with no deadline never runs out", () =>
  assert.equal(couponExpired("NOSUCHCODE", new Date("2099-01-01T00:00:00Z")), false),
);

check("the banner prints the day the server refuses after", () =>
  assert.equal(couponEndLabel("WELCOME3"), "26 August"),
);

console.log("\nFeedback");

check("a normal submission is accepted", () =>
  assert.deepEqual(
    validateFeedback({ name: "Ada", email: "ada@example.com", message: "Hello there." }),
    { ok: true, value: { name: "Ada", email: "ada@example.com", message: "Hello there." } },
  ),
);

check("an empty message is rejected", () =>
  assert.equal(
    validateFeedback({ name: "", email: "ada@example.com", message: "  " }).ok,
    false,
  ),
);

check("an over-long message is rejected", () =>
  assert.equal(
    validateFeedback({ name: "", email: "ada@example.com", message: "x".repeat(4001) }).ok,
    false,
  ),
);

check("a malformed email is rejected", () =>
  assert.equal(
    validateFeedback({ name: "", email: "ada@", message: "Hello there." }).ok,
    false,
  ),
);

console.log(failures ? `\n${failures} check(s) failed\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
