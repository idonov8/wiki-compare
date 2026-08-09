import { NextResponse } from "next/server";
import type { DonateRequest, DonateResponse } from "@/lib/types";
import { getSessionUser } from "@/lib/auth";
import { grant, hasHadMockGrant, recordDonation } from "@/lib/credits";
import { MOCK_GRANT_CENTS, formatCents } from "@/lib/pricing";
import { capture } from "@/lib/analytics";

export const runtime = "nodejs";

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
    : // No email promised here any more. The old copy told everybody who pressed
      // pay that they would be written to, which is a commitment s.30A does not
      // allow to be made on the strength of a payment. The reveal now says only
      // what is true of everyone, and the offer to be told sits beside it as a
      // button somebody can press or ignore.
      {
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
