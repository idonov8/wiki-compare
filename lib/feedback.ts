export interface FeedbackInput {
  name: string;
  email: string;
  message: string;
}

export type FeedbackValidation =
  | { ok: true; value: FeedbackInput }
  | { ok: false; error: string };

export function validateFeedback(input: unknown): FeedbackValidation {
  if (typeof input !== "object" || input === null) {
    return { ok: false, error: "Expected a feedback form." };
  }

  const raw = input as Record<string, unknown>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const email = typeof raw.email === "string" ? raw.email.trim() : "";
  const message = typeof raw.message === "string" ? raw.message.trim() : "";

  if (name.length > 120) return { ok: false, error: "Name is too long." };
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid email." };
  }
  if (!message) return { ok: false, error: "Message is required." };
  if (message.length > 4000) return { ok: false, error: "Message is too long." };

  return { ok: true, value: { name, email, message } };
}
