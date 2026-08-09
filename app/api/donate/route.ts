import { NextResponse } from "next/server";
import type { DonateRequest, DonateResponse } from "@/lib/types";
import { getSessionUser } from "@/lib/auth";
import { grant, hasHadMockGrant, recordDonation } from "@/lib/credits";
import { MOCK_GRANT_CENTS, formatCents } from "@/lib/pricing";
import { capture } from "@/lib/analytics";
import { recordEmailConsent } from "@/lib/consent";

export const runtime = "nodejs";

/**
 * The proposition the checkbox puts to somebody, stored verbatim with their
 * answer. s.30A consent is consent to a particular wording, so this string and
 * the one rendered in components/Donate.tsx have to stay the same sentence —
 * change one and the log starts claiming agreement to words nobody saw.
 */
const EMAIL_OPT_IN_WORDING = "Email me when payments are ready.";

/**
 * The mock payment.
 *
 * Nothing is charged, because nothing can be yet. What this route is actually
 * for is the row it writes: `donations` records every attempt, and the count of
 * people who tried to give money to something that could not take it is the only
 * evidence that any of this is worth building properly.
 *
 * So the recording happens for every attempt, and the grant happens once. A
 * second press is not an error and is not scolded — it is somebody offering
 * again, which is worth more than the first time, and it gets a promise rather
 * than a refusal. We can keep that promise: signing in was a magic link, so
 * their address is already on the user record.
 */
export async function POST(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) {
    return NextResponse.json({ error: "Sign in to donate." }, { status: 401 });
  }

  let body: DonateRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  // Clamped rather than rejected. A donation form is not a place to argue with
  // somebody about their input: any number they typed still means "I would pay",
  // which is the thing being measured, and the payment is imaginary anyway.
  const amountCents = clampMoney(body.amountCents);
  const maintenanceCents = clampMoney(body.maintenanceCents);
  const monthly = body.monthly === true;

  // Recorded before the grant, and independently of whether one happens: the
  // permission is about future messages, not about this donation, and tying the
  // two together is how a donation quietly becomes a subscription.
  const emailOptIn = body.emailOptIn === true;
  if (emailOptIn) {
    try {
      await recordEmailConsent({
        userId: user.id,
        email: user.email,
        granted: true,
        source: "donate",
        evidence: EMAIL_OPT_IN_WORDING,
      });
    } catch (error) {
      // The donation is not held up by the consent log. Failing to write the row
      // means the permission is not provable, so it does not exist — `mayEmail`
      // reads the log and finds nothing, which is the correct answer.
      console.warn("email consent not recorded:", error instanceof Error ? error.message : error);
    }
  }

  const alreadyGranted = await hasHadMockGrant(user.id);
  const grantedCents = alreadyGranted ? 0 : MOCK_GRANT_CENTS;

  await recordDonation({
    userId: user.id,
    amountCents,
    maintenanceCents,
    monthly,
    grantedCents,
  });

  void capture(
    "donate_attempted",
    { amountCents, maintenanceCents, monthly, from: body.from ?? null },
    user.id,
  );

  let creditCents = user.creditCents ?? 0;
  if (grantedCents) {
    creditCents = await grant(user.id, grantedCents);
    void capture("mock_grant_issued", { grantedCents }, user.id);
  }

  // The copy is split into a reveal the client can lay out with hierarchy
  // (kicker / headline / gift figure / body), while `message` stays the flat
  // full sentence for logs and screen readers. The wording still lives here
  // because only this side knows whether the account has been thanked before.
  const response: DonateResponse = grantedCents
    ? {
        granted: true,
        grantedCents,
        creditCents,
        message:
          `Oops, you caught us, we can't accept payments yet. But intention counts! \n` +
          `Here are ${formatCents(grantedCents)} of credit on us. Thank you so much.`,
        reveal: {
          kicker: "",
          headline: "Oops, you caught us, we can’t accept payments yet.",
          gift: formatCents(grantedCents),
          body: "Intention counts! Have some credit in the meantime. Thank you so much.",
        },
      }
    : // Two versions, and which one is sent turns on the checkbox rather than on
      // the donation. The old copy promised an email to everybody, which is a
      // commitment s.30A does not allow to be made on the strength of a payment
      // — so the promise is now only made to somebody who asked for it, and the
      // rest are thanked without one being implied.
      emailOptIn
      ? {
          granted: false,
          grantedCents,
          creditCents,
          message: `You'll get an email once we are ready to accept payments. Soon, I promise.`,
          reveal: {
            kicker: "",
            headline: "We’ll email you once payments are ready.",
            gift: null,
            body: "Soon, I promise. Thanks again :)",
          },
        }
      : {
          granted: false,
          grantedCents,
          creditCents,
          message: `Payments still aren't ready, but the offer is noted. Thanks again.`,
          reveal: {
            kicker: "",
            headline: "Payments still aren’t ready.",
            gift: null,
            body: "Your offer is noted, which is the part that counts. Thanks again :)",
          },
        };
  return NextResponse.json(response);
}

function clampMoney(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
  return Math.min(Math.max(n, 0), 1_000_00);
}
