import { NextResponse } from "next/server";
import { addSubscriber } from "@/lib/db";
import { isEmail } from "@/lib/feedback";
import { allow, visitorKey } from "@/lib/rate-limit";
import { capture } from "@/lib/analytics";

export const runtime = "nodejs";

/** Puts an address on the list for occasional project updates. */
export async function POST(request: Request) {
  let email: unknown;
  try {
    ({ email } = await request.json());
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  if (typeof email !== "string" || !isEmail(email.trim())) {
    return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  }
  if (!allow(`subscribe:${visitorKey(request.headers)}`, 5, 60 * 60_000)) {
    return NextResponse.json({ error: "Too many sign-ups from here; try again later." }, { status: 429 });
  }

  try {
    await addSubscriber(email.trim());
  } catch (error) {
    console.error("subscribe failed:", error);
    return NextResponse.json({ error: "Couldn't sign you up just now. Please try again later." }, { status: 500 });
  }
  void capture("updates_subscribed", {});
  return NextResponse.json({ ok: true });
}
