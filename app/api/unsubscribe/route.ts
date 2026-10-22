import { NextResponse } from "next/server";
import { removeSubscriber } from "@/lib/db";
import { capture } from "@/lib/analytics";

export const runtime = "nodejs";

/**
 * The unsubscribe page's button. A POST rather than the link itself, because
 * mail scanners open every link in a message and would unsubscribe people who
 * never asked to.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const token = form.get("token");
  const done = typeof token === "string" && token.length <= 100 && (await removeSubscriber(token));
  if (done) void capture("updates_unsubscribed", {});
  return NextResponse.redirect(new URL(`/unsubscribe?${done ? "done=1" : "unknown=1"}`, request.url), 303);
}
