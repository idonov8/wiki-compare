import { NextResponse } from "next/server";
import type { CouponRequest, CouponResponse } from "@/lib/types";
import { getSessionUser } from "@/lib/auth";
import { claimCoupon, grant } from "@/lib/credits";
import { couponValue, normalizeCoupon } from "@/lib/coupons";
import { formatCents } from "@/lib/pricing";
import { capture } from "@/lib/analytics";

export const runtime = "nodejs";

/**
 * Redeeming a coupon.
 *
 * Its own route because it is its own action. A coupon used to ride along with
 * the pay button, which meant a code could only be checked by committing to a
 * donation you might not want to make, and a mistyped one came back attached to
 * a thank-you screen for something else entirely. Here it answers one question —
 * is this code real, and is it mine to use — and answers it the moment it is
 * asked.
 *
 * Unlike the mock payment, this credit is real: nothing about a coupon is
 * pretending, so the balance moves and the meter in the masthead moves with it.
 */
export async function POST(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) {
    return NextResponse.json({ error: "Sign in to redeem a coupon." }, { status: 401 });
  }

  let body: CouponRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  // Bounded before it is looked up, let alone stored: the code is a short token
  // from a text field, and a lookup key has no business being a kilobyte long.
  const code = normalizeCoupon(typeof body.code === "string" ? body.code.slice(0, 64) : "");
  if (!code) {
    return NextResponse.json({ error: "Type a code first." }, { status: 400 });
  }

  const cents = couponValue(code);
  if (cents === null) {
    // Worth capturing rather than only refusing. A code we don't know is either
    // a typo or somebody quoting one we retired, and which of those it is only
    // shows up in the aggregate.
    void capture("coupon_rejected", { code }, user.id);
    return NextResponse.json({ error: `${code} isn't a code we know.` }, { status: 404 });
  }

  // Second press of a code that worked. Not scolded, just told — the credit is
  // already on the account it was meant for, which is not a failure of anything.
  if (!(await claimCoupon(user.id, code, cents))) {
    return NextResponse.json(
      { error: `You've already redeemed ${code}.` },
      { status: 409 },
    );
  }

  const creditCents = await grant(user.id, cents);
  void capture("coupon_redeemed", { code, grantedCents: cents }, user.id);

  const response: CouponResponse = {
    code,
    grantedCents: cents,
    creditCents,
    message: `${formatCents(cents)} of credit added.`,
  };
  return NextResponse.json(response);
}
