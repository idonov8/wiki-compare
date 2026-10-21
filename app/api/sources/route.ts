import { NextResponse } from "next/server";
import { LANGS, type Lang, type Source } from "@/lib/types";
import { matchSources } from "@/lib/sources";
import { sourcesFor } from "@/lib/articles";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * What each version cites, and which of those citations the others share.
 *
 * Its own route rather than part of the comparison, because it is not part of
 * the comparison: nothing here goes near a model, so it costs no tokens. Asked
 * for by revision id — the ones the columns are actually showing, which on a
 * cached comparison are not necessarily the live ones.
 *
 * A language that cannot be read is left out rather than failing the request.
 * Two lists still say something true about each other; one missing list only
 * costs the badges that would have named it, and the response says which
 * languages it was matched across so nothing claims more than it looked at.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const wanted: { lang: Lang; revid: number }[] = [];
  for (const lang of LANGS) {
    const revid = Number(params.get(lang));
    if (Number.isInteger(revid) && revid > 0) wanted.push({ lang, revid });
  }
  if (!wanted.length) {
    return NextResponse.json(
      { error: "Add a revision id per language, e.g. ?en=123&he=456." },
      { status: 400 },
    );
  }

  const read = await Promise.all(
    wanted.map(async ({ lang, revid }) => {
      try {
        return { lang, sources: await sourcesFor(lang, revid) };
      } catch (error) {
        console.warn(`sources for ${lang}:${revid} unavailable:`, error);
        return { lang, sources: null };
      }
    }),
  );

  const byLang: Partial<Record<Lang, Source[]>> = {};
  for (const { lang, sources } of read) if (sources) byLang[lang] = sources;

  if (!Object.keys(byLang).length) {
    return NextResponse.json({ error: "Could not read the reference lists." }, { status: 502 });
  }

  // Revision ids are immutable and every one of them is in the URL, so this
  // answer can never go stale — but only cache it that way once every language
  // asked for actually answered, or one failed fetch would be stored as the
  // truth about the article for a year.
  const complete = read.every(({ sources }) => sources);
  return NextResponse.json(matchSources(byLang), {
    headers: {
      "Cache-Control": complete
        ? "public, max-age=3600, s-maxage=31536000, immutable"
        : "public, max-age=0, s-maxage=60",
    },
  });
}
