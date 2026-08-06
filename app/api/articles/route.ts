import { NextResponse } from "next/server";
import { resolveTarget, snapshotsFor } from "@/lib/articles";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The articles themselves, with no comparison attached: what the reader confirms
 * they picked the right subject against, and what the wait is then spent
 * looking at. Costs no tokens, and warms the article cache the comparison reads.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const title = params.get("title")?.trim();
  const lang = params.get("lang")?.trim() || "en";

  if (!title) return NextResponse.json({ error: "Add a ?title= parameter." }, { status: 400 });

  if (process.env.NODE_ENV !== "production" && title.startsWith("demo:")) {
    const { demoComparison } = await import("@/fixtures/demo");
    const demo = demoComparison(title.slice(5));
    return NextResponse.json({ qid: demo.qid, articles: demo.articles });
  }

  try {
    const { qid, titles, revids, langs } = await resolveTarget(title, lang);
    const articles = await snapshotsFor(langs, titles, revids);
    return NextResponse.json({
      qid,
      articles: Object.fromEntries(articles.map((a) => [a.lang, a])),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load the articles.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
