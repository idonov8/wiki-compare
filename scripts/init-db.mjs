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
 * Split on statement boundaries, not on every semicolon. Dollar-quoted bodies
 * (DO $$ ... END $$) contain their own semicolons, and splitting naively slices
 * them into fragments that are not valid SQL on their own.
 */
function statements(source) {
  const out = [];
  let buffer = "";
  let tag = null;

  for (let i = 0; i < source.length; i++) {
    if (!tag) {
      const open = /^\$([A-Za-z_]\w*)?\$/.exec(source.slice(i));
      if (open) {
        tag = open[0];
        buffer += tag;
        i += tag.length - 1;
        continue;
      }
      if (source[i] === ";") {
        out.push(buffer);
        buffer = "";
        continue;
      }
    } else if (source.startsWith(tag, i)) {
      buffer += tag;
      i += tag.length - 1;
      tag = null;
      continue;
    }
    buffer += source[i];
  }
  out.push(buffer);

  return out.map((s) => s.trim()).filter((s) => s && !/^(--[^\n]*\n?)*$/.test(s));
}

for (const statement of statements(schema)) {
  await sql.query(statement);
}

console.log("Schema applied.");
