import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * The onboarding tour has been finished.
 *
 * Takes no body: the only thing it can say is "done", about whoever is signed
 * in. A boolean from the client would be a way to un-finish somebody else's
 * tour, and there is nothing to gain by allowing it.
 *
 * Written straight here rather than through Better Auth's update-user API, which
 * refuses this column by design (`input: false` in lib/auth.ts), and rather than
 * through lib/credits.ts, which is about money.
 *
 * Failures are reported, but the caller is expected to shrug: the browser's own
 * copy of the progress has already moved on, so the worst case is the tour
 * coming back on a second device.
 */
export async function POST(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    return NextResponse.json({ error: "Storage unavailable." }, { status: 500 });
  }

  try {
    await neon(url)`
      UPDATE "user" SET "onboardingDone" = true WHERE id = ${user.id}
    `;
  } catch (error) {
    console.warn("onboarding flag not saved:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "That didn't save." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
