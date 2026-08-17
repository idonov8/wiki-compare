import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * The onboarding tour has been finished, by whoever is signed in. No body: a
 * boolean from the client would be a way to un-finish somebody's tour. Written
 * in SQL because Better Auth refuses the column by design (`input: false`).
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
