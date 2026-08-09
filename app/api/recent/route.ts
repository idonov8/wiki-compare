import { NextResponse } from "next/server";
import { recentComparisons } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The recently cached articles, for the landing page.
 *
 * Never fails the caller. This list is an offer, not an answer: a database that
 * is unreachable, or absent entirely while someone works on the rendering layer
 * against fixtures, should leave the landing page one section shorter rather
 * than show an error for something nobody asked for.
 */
export async function GET() {
  try {
    return NextResponse.json({ items: await recentComparisons() });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
