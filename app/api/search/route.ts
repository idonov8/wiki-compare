import { NextResponse } from "next/server";
import { guessLang, parseWikipediaUrl, searchArticles } from "@/lib/wikipedia";

export const runtime = "nodejs";

/**
 * Candidate articles for a query, so the reader picks the subject before
 * anything is fetched or read. A pasted article URL skips the search and comes
 * back as the single exact hit it names.
 */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query) return NextResponse.json({ error: "Add a ?q= parameter." }, { status: 400 });

  const pasted = parseWikipediaUrl(query);
  if (pasted) {
    return NextResponse.json({
      exact: true,
      results: [
        {
          ...pasted,
          url: query,
          description: `${pasted.lang}.wikipedia.org`,
        },
      ],
    });
  }

  try {
    const lang = guessLang(query);
    return NextResponse.json({ exact: false, results: await searchArticles(lang, query) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
