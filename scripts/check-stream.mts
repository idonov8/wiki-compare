/**
 * Assertions over the incremental claim parser: that a claim comes out whole the
 * moment its brace closes, and that nothing comes out twice or early. No
 * network, no model, no database.
 *
 *   npm run check:stream
 */
import { ClaimStream } from "../lib/stream-json";

let failures = 0;
const check = (ok: boolean, label: string, detail = "") => {
  if (ok) console.log(`    ok    ${label}`);
  else {
    failures++;
    console.log(`    FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
};

type Claim = { type?: string; summary?: string; spans?: Record<string, string> };

/** Feed a document one character at a time — the worst case the transport can
 *  produce, and the one that catches a scanner that assumes chunk boundaries
 *  fall anywhere convenient. */
function drip(text: string): Claim[] {
  const stream = new ClaimStream();
  const out: Claim[] = [];
  for (const ch of text) out.push(...(stream.push(ch) as Claim[]));
  return out;
}

/** The same document in one chunk, which must give the same answer. */
function whole(text: string): Claim[] {
  return new ClaimStream().push(text) as Claim[];
}

console.log("\nincremental claim parsing");

const simple = `{"claims":[{"type":"unique","summary":"one"},{"type":"framing","summary":"two"}]}`;
check(drip(simple).length === 2, "two claims arrive from a character-by-character feed");
check(whole(simple).length === 2, "the same two arrive from a single chunk");
check(
  JSON.stringify(drip(simple)) === JSON.stringify(whole(simple)),
  "chunking does not change the result",
);

// ---- claims are emitted early, not at the end --------------------------------

{
  const stream = new ClaimStream();
  const first = stream.push(`{"claims":[{"type":"unique","summary":"one"},`);
  check(first.length === 1, "the first claim is emitted before the second is written");

  const second = stream.push(`{"type":"framing","summary":"two"}`);
  check(second.length === 1, "the second is emitted on its own closing brace");
  check((second[0] as Claim).summary === "two", "and it is the right one");

  check(stream.push(`]}`).length === 0, "the document's own close emits nothing further");
}

// ---- braces and quotes inside claim text -------------------------------------

{
  const tricky = `{"claims":[{"summary":"a } brace","explanation":"a \\" quote and a { brace"}]}`;
  const got = drip(tricky);
  check(got.length === 1, "a claim containing braces and an escaped quote is one claim");
  check(got[0]?.summary === "a } brace", "a brace inside a string does not close the object");
}

{
  // A span ending in a backslash: the escape must not swallow the closing quote.
  const escaped = `{"claims":[{"summary":"ends with a backslash \\\\","type":"framing"}]}`;
  const got = drip(escaped);
  check(got.length === 1, "a trailing escaped backslash does not run the string on");
  check(got[0]?.type === "framing", "and the rest of the object still parses");
}

// ---- nesting -----------------------------------------------------------------

{
  const nested = `{"claims":[{"summary":"one","spans":{"en":"x","he":"y"}},{"summary":"two","spans":{}}]}`;
  const got = drip(nested);
  check(got.length === 2, "a nested spans object does not end the claim early");
  check(got[0]?.spans?.he === "y", "the nested object survives intact");
}

// ---- real-world shapes -------------------------------------------------------

{
  const fenced = "```json\n" + `{"claims":[{"summary":"one"}]}` + "\n```";
  check(drip(fenced).length === 1, "a code fence around the document is ignored");
}

{
  const rtl = `{"claims":[{"summary":"terminology","spans":{"he":"יהודה ושומרון","ar":"الضفة الغربية"}}]}`;
  const got = drip(rtl);
  check(got.length === 1, "right-to-left spans parse");
  check(got[0]?.spans?.he === "יהודה ושומרון", "and are not mangled");
}

{
  // Truncation: the model hit max_tokens mid-claim. Whatever finished is kept.
  const cut = `{"claims":[{"summary":"one"},{"summary":"tw`;
  const got = drip(cut);
  check(got.length === 1, "a truncated stream still yields the claims that completed");
}

{
  const empty = `{"claims":[]}`;
  check(drip(empty).length === 0, "an empty claims array yields nothing");
}

{
  // Preamble before the array, which the prompt forbids and models do anyway.
  const chatty = `Here are the differences:\n{"claims":[{"summary":"one"}]}`;
  check(drip(chatty).length === 1, "prose before the JSON is skipped");
}

console.log(failures ? `\n${failures} check(s) failed\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
