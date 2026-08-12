import { NextResponse } from "next/server";
import type { CouponCheck, CouponRequest, CouponResponse } from "@/lib/types";
import { getSessionUser } from "@/lib/auth";
import { claimCoupon, grant, hasRedeemed } from "@/lib/credits";
import { couponEndLabel, couponExpired, couponValue, normalizeCoupon } from "@/lib/coupons";
import { formatCents } from "@/lib/pricing";
import { capture } from "@/lib/analytics";

export const runtime = "nodejs";

/**
 * GET checks a code and changes nothing; POST redeems it. The split is so a
 * reader can find out whether a code is real without committing to a donation.
 *
 * The check is deliberately not authoritative: between a GET saying yes and a
 * POST acting on it, the same account can spend the code in another tab, so the
 * unique index the POST inserts against stays the only thing that decides.
 */
export async function GET(request: Request) {
  const asked = await resolve(request.headers, new URL(request.url).searchParams.get("code"));
  if (asked instanceof NextResponse) return asked;
  const { userId, code, cents } = asked;

  try {
    if (await hasRedeemed(userId, code)) {
      return NextResponse.json({ error: `You've already redeemed ${code}.` }, { status: 409 });
    }
  } catch (error) {
    return dbFailure(error, "That code couldn't be checked just now. Please try again.");
  }

  const response: CouponCheck = { code, cents };
  return NextResponse.json(response);
}

/** Redeeming, from the pay button. Unlike the payment beside it, real. */
export async function POST(request: Request) {
  let body: CouponRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const asked = await resolve(request.headers, body.code);
  if (asked instanceof NextResponse) return asked;
  const { userId, code, cents } = asked;

  let creditCents: number;
  try {
    if (!(await claimCoupon(userId, code, cents))) {
      return NextResponse.json({ error: `You've already redeemed ${code}.` }, { status: 409 });
    }
    creditCents = await grant(userId, cents);
  } catch (error) {
    return dbFailure(error, "That code couldn't be redeemed just now. Please try again.");
  }

  void capture("coupon_redeemed", { code, grantedCents: cents }, userId);

  const response: CouponResponse = {
    code,
    grantedCents: cents,
    creditCents,
    message: `${formatCents(cents)} of credit added.`,
  };
  return NextResponse.json(response);
}

/**
 * Everything both verbs need before they can differ, or the refusal to send
 * instead. Shared so the two cannot drift apart on wording or status.
 */
async function resolve(
  headers: Headers,
  raw: unknown,
): Promise<{ userId: string; code: string; cents: number } | NextResponse> {
  const user = await getSessionUser(headers);
  if (!user) {
    return NextResponse.json({ error: "Sign in to use a coupon." }, { status: 401 });
  }

  const code = normalizeCoupon(typeof raw === "string" ? raw.slice(0, 64) : "");
  if (!code) {
    return NextResponse.json({ error: "Type a code first." }, { status: 400 });
  }

  const cents = couponValue(code);
  if (cents === null) {
    // Captured, not just refused: typos and retired codes only separate in bulk.
    void capture("coupon_rejected", { code }, user.id);
    return NextResponse.json({ error: `${code} isn't a code we know.` }, { status: 404 });
  }

  // A code that ran out is a real code, so it is refused in its own words and
  // with its own status: "isn't a code we know" reads as a typo, and somebody
  // typing a code off a banner that has come down deserves to be told which of
  // the two happened.
  if (couponExpired(code)) {
    void capture("coupon_rejected", { code, expired: true }, user.id);
    return NextResponse.json(
      { error: `${code} ran out on ${couponEndLabel(code)}.` },
      { status: 410 },
    );
  }

  return { userId: user.id, code, cents };
}

/**
 * A database failure, as JSON. A route that throws answers 500 with no body,
 * and `res.json()` on no body is "Unexpected end of JSON input" — a parser
 * complaining about the shape of nothing, in place of the reason.
 *
 * 42P01 is undefined_table: db/schema.sql has moved on and this database has
 * not. A skipped setup step rather than a fault, so it says so.
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
