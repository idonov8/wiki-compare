import { NextResponse } from "next/server";
import type { MeResponse } from "@/lib/types";
import { getSessionUser } from "@/lib/auth";
import { creditSummary } from "@/lib/credits";

export const runtime = "nodejs";

/**
 * Who is reading, and what their donation has bought.
 *
 * Answers `null` rather than 401 for a signed-out reader: not being signed in is
 * the ordinary state of this site, not an error, and the masthead asks this on
 * every page load. A 401 would put a red herring in everyone's network tab and
 * tempt the client into treating a normal visit as a failure.
 *
 * Like `/api/recent`, it never fails the caller. If the ledger is unreachable
 * the two thank-you figures come back as zero and the credit bar simply says
 * less, which is a better outcome than an error nobody asked for.
 */
export async function GET(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) return NextResponse.json(null);

  let summary = { articlesProcessed: 0, readsOfThoseArticles: 0 };
  try {
    summary = await creditSummary(user.id);
  } catch (error) {
    console.warn("credit summary unavailable:", error instanceof Error ? error.message : error);
  }

  const body: MeResponse = {
    email: user.email,
    creditCents: user.creditCents ?? 0,
    peakCreditCents: user.peakCreditCents ?? 0,
    ...summary,
  };
  return NextResponse.json(body);
}
