import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

const sql = neon(url);
const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");

/**
 * Split on statement boundaries, not on every semicolon.
 *
 * A semicolon only ends a statement when it is read as code. Four constructs in
 * db/schema.sql can contain one that isn't:
 *
 *   - dollar-quoted bodies (DO $$ ... END $$), whose whole point is to hold
 *     semicolon-separated statements as a single literal;
 *   - `--` line comments, which in that file carry English prose, and English
 *     prose contains semicolons;
 *   - block comments, which Postgres allows to nest;
 *   - single-quoted literals and double-quoted identifiers, both of which escape
 *     their own quote by doubling it.
 *
 * Splitting on every semicolon slices those into fragments that are not valid
 * SQL on their own, and the resulting error names whatever word happened to
 * follow the semicolon — which points at a comment rather than at a mistake.
 * So this walks the text once, skipping over each construct whole.
 */
function statements(source) {
  const out = [];
  let buffer = "";
  let i = 0;

  /** Consume from `i` up to `stop`, keeping it in the current statement. */
  const take = (stop) => {
    buffer += source.slice(i, stop);
    i = stop;
  };

  while (i < source.length) {
    const dollar = /^\$([A-Za-z_]\w*)?\$/.exec(source.slice(i));
    if (dollar) {
      const tag = dollar[0];
      const close = source.indexOf(tag, i + tag.length);
      take(close === -1 ? source.length : close + tag.length);
      continue;
    }

    if (source.startsWith("--", i)) {
      const newline = source.indexOf("\n", i);
      take(newline === -1 ? source.length : newline + 1);
      continue;
    }

    if (source.startsWith("/*", i)) {
      let depth = 0;
      let j = i;
      while (j < source.length) {
        if (source.startsWith("/*", j)) {
          depth++;
          j += 2;
        } else if (source.startsWith("*/", j)) {
          depth--;
          j += 2;
          if (depth === 0) break;
        } else {
          j++;
        }
      }
      take(j);
      continue;
    }

    if (source[i] === "'" || source[i] === '"') {
      const quote = source[i];
      let j = i + 1;
      while (j < source.length) {
        if (source[j] !== quote) {
          j++;
        } else if (source[j + 1] === quote) {
          j += 2;
        } else {
          j++;
          break;
        }
      }
      take(j);
      continue;
    }

    if (source[i] === ";") {
      out.push(buffer);
      buffer = "";
      i++;
      continue;
    }

    take(i + 1);
  }
  out.push(buffer);

  return out.map((s) => s.trim()).filter((s) => s && !isCommentOnly(s));
}

/**
 * Whether a chunk is only comments and whitespace — the tail after the last
 * semicolon usually is. Postgres answers an empty query with an error rather
 * than a shrug, so these are dropped instead of sent. Stripping comments with a
 * regex would be wrong inside a string literal, but this only decides whether to
 * skip; the statement itself is always sent verbatim.
 */
function isCommentOnly(statement) {
  return !statement
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "")
    .trim();
}

const all = statements(schema);

for (const [index, statement] of all.entries()) {
  try {
    await sql.query(statement);
  } catch (cause) {
    // Which statement failed, not just what the driver thought of it. A bare
    // "syntax error at or near ..." names a token that appears in the file many
    // times over, and finding it by eye is the slowest part of fixing it.
    console.error(`Statement ${index + 1} of ${all.length} failed:\n${statement}\n`);
    throw cause;
  }
}

console.log(`Schema applied — ${all.length} statements, all idempotent.`);
