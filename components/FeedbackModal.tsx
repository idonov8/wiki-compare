"use client";

import { useEffect, useRef, useState } from "react";
import { BETA_GROUP_URL, CONTACT_EMAIL } from "@/lib/contact";

/**
 * A deliberately small route into the inbox: the reader can send a note from
 * here, or choose the direct address and beta group below it.
 */
export default function FeedbackModal({ onDismiss }: { onDismiss: () => void }) {
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    nameRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSending(true);
    setFailed(false);
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, message }),
      });
      if (!response.ok) throw new Error("feedback failed");
      setSent(true);
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-[color-mix(in_srgb,var(--color-ink)_44%,transparent)] p-[20px] max-tight:p-[12px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-modal-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onDismiss();
      }}
    >
      <div className="relative max-h-[calc(100vh-24px)] w-full max-w-[480px] overflow-hidden rounded-[2px] border border-ink bg-paper-raised shadow-offset animate-reveal-in">
        <div className="flex h-[7px]" aria-hidden="true">
          <span className="flex-1 bg-contradiction" />
          <span className="flex-1 bg-unique" />
          <span className="flex-1 bg-framing" />
        </div>

        <div className="max-h-[calc(100vh-31px)] overflow-y-auto px-[42px] pt-[30px] pb-[30px] max-tight:px-[24px] max-tight:pt-[27px] max-tight:pb-[24px]">
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close feedback"
            className="absolute top-[19px] right-[16px] grid h-[32px] w-[32px] place-items-center rounded-full border border-transparent bg-transparent font-mono text-[19px] leading-none text-ink-soft transition-colors duration-150 ease-[ease] hover:border-rule hover:bg-ink-wash hover:text-ink"
          >
            ×
          </button>

          <h2
            id="feedback-modal-title"
            className="m-0 mb-[20px] font-display text-[30px] font-normal leading-[1.15] max-tight:text-[27px]"
          >
            Send Feedback
          </h2>
          <p className="m-0 mb-[20px] font-mono text-[13px] text-ink-soft">
            Ideas? Questions? Bugs? We'd love to hear them.
          </p>
          {sent ? (
            <p className="m-0 font-mono text-[13px] text-ink-soft">Sent. Thanks.</p>
          ) : (
            <form onSubmit={submit} className="grid gap-[15px]">
              <label className="grid gap-[6px]">
                <span className="font-mono text-[11px] tracking-[0.1em] text-ink-soft uppercase">Name</span>
                <input
                  ref={nameRef}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="border border-rule bg-paper px-[10px] py-[9px] font-body text-[15px] text-ink outline-none focus:border-ink"
                  type="text"
                  autoComplete="name"
                />
              </label>
              <label className="grid gap-[6px]">
                <span className="font-mono text-[11px] tracking-[0.1em] text-ink-soft uppercase">Email</span>
                <input
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="border border-rule bg-paper px-[10px] py-[9px] font-body text-[15px] text-ink outline-none focus:border-ink"
                  type="email"
                  autoComplete="email"
                  required
                />
              </label>
              <label className="grid gap-[6px]">
                <span className="font-mono text-[11px] tracking-[0.1em] text-ink-soft uppercase">Message</span>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  className="resize-y border border-rule bg-paper px-[10px] py-[9px] font-body text-[15px] leading-[1.5] text-ink outline-none focus:border-ink"
                  rows={4}
                  required
                />
              </label>
              {failed && (
                <p className="m-0 font-mono text-[12px] leading-[1.5] text-contradiction">
                  That didn&apos;t send. Try the email below.
                </p>
              )}
              <button
                type="submit"
                disabled={sending || !email.trim() || !message.trim()}
                className="mt-[2px] justify-self-start border border-ink bg-ink px-[24px] py-[11px] font-mono text-[12px] tracking-[0.08em] text-paper-raised transition-transform duration-150 ease-[ease] hover:enabled:-translate-y-[1px] disabled:cursor-progress disabled:opacity-45"
              >
                {sending ? "Sending…" : "Send"}
              </button>
            </form>
          )}

          <div className="mt-[26px] border-t border-rule pt-[20px] font-mono text-[12px] leading-[1.5] text-ink-soft">
            Reach us via&nbsp;
            <a className="w-fit hover:text-ink hover:underline" href={`mailto:${CONTACT_EMAIL}`}>
              {CONTACT_EMAIL}
            </a>
            <br />
            Or join the&nbsp;<a
              className="w-fit hover:text-ink hover:underline"
              href={BETA_GROUP_URL}
              target="_blank"
              rel="noopener noreferrer"
            >
              Beta WhatsApp group :)
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
