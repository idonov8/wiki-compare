import { NextResponse } from "next/server";
import { CONTACT_EMAIL } from "@/lib/contact";
import { validateFeedback } from "@/lib/feedback";
import { sendMail } from "@/lib/mail";

export const runtime = "nodejs";

/**
 * Anonymous feedback goes straight to the site inbox. There is no account to
 * attach it to, and the reply address belongs to the person who submitted it.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const result = validateFeedback(body);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const { name, email, message } = result.value;
  const to = process.env.FEEDBACK_TO || CONTACT_EMAIL;

  // ponytail: There is no rate limiting or spam control here yet; add an edge
  // rate limit and abuse filter before this route is exposed to larger traffic.
  try {
    await sendMail({
      to,
      subject: "Wiki Compare feedback",
      replyTo: email,
      text: `Name: ${name || "(not provided)"}\nEmail: ${email}\n\n${message}`,
    });
  } catch (error) {
    console.error("[feedback] email failed:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "That didn't send. Try the email below." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
