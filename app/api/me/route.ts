import { NextResponse } from "next/server";
import type { MeResponse } from "@/lib/types";
import { getSessionUser } from "@/lib/auth";
import { creditSummary } from "@/lib/credits";
import { SIGNUP_GRANT_CENTS } from "@/lib/pricing";

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

  const creditCents = user.creditCents ?? 0;
  const peakCreditCents = user.peakCreditCents ?? 0;

  const body: MeResponse = {
    email: user.email,
    creditCents,
    peakCreditCents,
    ...summary,
    /**
     * Somebody who has just arrived: the credit they hold is the sign-up grant,
     * they have never topped it up, and they have not spent any of it yet. Read
     * off the balance rather than off `createdAt`, because what the note beside
     * the meter explains is the credit, not the age of the account — an account
     * made a month ago and never used still has that explanation coming, and one
     * made this morning that has already processed an article does not.
     */
    newcomer:
      creditCents > 0 &&
      peakCreditCents <= SIGNUP_GRANT_CENTS &&
      summary.articlesProcessed === 0,
  };
  return NextResponse.json(body);
}
