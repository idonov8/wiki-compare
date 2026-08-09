import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { recordEmailConsent } from "@/lib/consent";
import { EMAIL_CONSENT_WORDING } from "@/lib/types";
import { capture } from "@/lib/analytics";

export const runtime = "nodejs";

/**
 * Somebody asking to be written to when payments open.
 *
 * Its own route rather than a field on `/api/donate`, because the permission is
 * its own act. Bundled into the donation it would be consent inferred from a
 * payment, which is the thing s.30A does not allow — and it would be unavailable
 * to anyone who wanted to be told but did not want to donate.
 *
 * Deliberately requires a session. Consent has to attach to somebody, and the
 * address written to is the one on the account rather than one typed here: a
 * free-text field would let this route be used to sign up an address its owner
 * never touched, which is a spam vector wearing a consent form's clothes.
 *
 * Unlike the read-only routes around it, this one reports its failures. It
 * exists to make a promise, and a promise that quietly failed to record is worse
 * than one visibly refused — the reader would leave believing they had been
 * added to a list that has no row for them.
 */
export async function POST(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  try {
    await recordEmailConsent({
      userId: user.id,
      email: user.email,
      granted: true,
      source: "donate",
      evidence: EMAIL_CONSENT_WORDING,
    });
  } catch (error) {
    console.error("email consent not recorded:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "That didn't save. Try again in a moment." }, { status: 500 });
  }

  void capture("email_consent_granted", { source: "donate" }, user.id);
  return NextResponse.json({ ok: true });
}
