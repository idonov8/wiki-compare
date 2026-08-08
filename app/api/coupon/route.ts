import { NextResponse } from "next/server";
import type { CouponCheck, CouponRequest, CouponResponse } from "@/lib/types";
import { getSessionUser } from "@/lib/auth";
import { claimCoupon, grant, hasRedeemed } from "@/lib/credits";
import { couponValue, normalizeCoupon } from "@/lib/coupons";
import { formatCents } from "@/lib/pricing";
import { capture } from "@/lib/analytics";

export const runtime = "nodejs";

/**
 * Coupons, in two halves: asking, and doing.
 *
 * GET checks a code and changes nothing. POST redeems it. The split is the
 * point — a code used to be a field the pay button carried along, so the only
 * way to find out whether one was real was to commit to a donation you might
 * not want to make, and a typo came back attached to a thank-you screen for
 * something else. Now the small button beside the field asks, and the pay
 * button is still the thing that commits, which is where a commitment belongs.
 *
 * The check is deliberately not authoritative, and does not try to be. Between
 * a GET saying yes and a POST acting on it, the same account can redeem the
 * same code in another tab — so the unique index the POST inserts against
 * stays the only thing that decides, and the GET is what it looks like: a
 * question, answered honestly at the time it was asked.
 */
export async function GET(request: Request) {
  const user = await getSessionUser(request.headers);
  if (!user) {
    return NextResponse.json({ error: "Sign in to use a coupon." }, { status: 401 });
  }

  const code = normalizeCoupon(new URL(request.url).searchParams.get("code")?.slice(0, 64) ?? "");
  if (!code) return NextResponse.json({ error: "Type a code first." }, { status: 400 });

  const cents = couponValue(code);
  if (cents === null) {
    // Worth capturing rather than only refusing. A code we don't know is either
    // a typo or somebody quoting one we retired, and which of those it is only
    // shows up in the aggregate.
    void capture("coupon_rejected", { code }, user.id);
    return NextResponse.json({ error: `${code} isn't a code we know.` }, { status: 404 });
  }

  try {
    if (await hasRedeemed(user.id, code)) {
      return NextResponse.json({ error: `You've already redeemed ${code}.` }, { status: 409 });
    }
  } catch (error) {
    return dbFailure(error, "That code couldn't be checked just now. Please try again.");
  }

  const response: CouponCheck = { code, cents };
  return NextResponse.json(response);
}

/**
 * Redeeming, which happens on the pay button and nowhere else.
 *
 * The credit is real, unlike the payment beside it: nothing about a coupon is
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
    void capture("coupon_rejected", { code }, user.id);
    return NextResponse.json({ error: `${code} isn't a code we know.` }, { status: 404 });
  }

  let creditCents: number;
  try {
    // Second press of a code that worked. Not scolded, just told — the credit
    // is already on the account it was meant for, which is not a failure of
    // anything.
    if (!(await claimCoupon(user.id, code, cents))) {
      return NextResponse.json({ error: `You've already redeemed ${code}.` }, { status: 409 });
    }
    creditCents = await grant(user.id, cents);
  } catch (error) {
    return dbFailure(error, "That code couldn't be redeemed just now. Please try again.");
  }

  void capture("coupon_redeemed", { code, grantedCents: cents }, user.id);

  const response: CouponResponse = {
    code,
    grantedCents: cents,
    creditCents,
    message: `${formatCents(cents)} of credit added.`,
  };
  return NextResponse.json(response);
}

/**
 * A database failure, as JSON.
 *
 * A route that throws answers 500 with no body at all, and `res.json()` on no
 * body is "Unexpected end of JSON input" — a parser complaining about the shape
 * of nothing, in place of the reason. Every other way out of this file is JSON,
 * so this one is too, whatever went wrong behind it.
 *
 * 42P01 is undefined_table, which here means one thing: db/schema.sql has moved
 * on and this database has not. It gets its own sentence because it is a setup
 * step somebody skipped rather than a fault, and the fix is one command.
 */
function dbFailure(error: unknown, fallback: string) {
  console.error("[coupon] database call failed:", error);
  const missingTable =
    typeof error === "object" && error !== null && (error as { code?: string }).code === "42P01";
  if (missingTable) {
    console.error("[coupon] run `npm run db:init` to create coupon_redemptions.");
  }
  return NextResponse.json(
    { error: missingTable ? "Coupons aren't set up on this server yet." : fallback },
    { status: 500 },
  );
}
