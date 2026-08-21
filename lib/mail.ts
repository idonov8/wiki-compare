interface Mail {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

/**
 * Sends one plain-text message through Resend without adding an SDK dependency.
 *
 * A local or preview deployment without a key prints the payload instead of
 * failing, while production refuses to claim a message was sent.
 */
export async function sendMail({ to, subject, text, replyTo }: Mail): Promise<void> {
  const payload = {
    from: "wiki-compare <onboarding@resend.dev>",
    to: [to],
    subject,
    text,
    ...(replyTo ? { reply_to: replyTo } : {}),
  };
  const key = process.env.RESEND_API_KEY;

  if (!key) {
    if (process.env.VERCEL_ENV === "production") {
      throw new Error("RESEND_API_KEY is not set, so the email cannot be delivered.");
    }
    console.log("[mail] RESEND_API_KEY missing; would send:", payload);
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Resend rejected the email (${response.status}): ${await response.text()}`);
  }
}
