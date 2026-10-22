"use client";

import { useState } from "react";
import { track } from "@/lib/analytics";

/** One field in the footer: an address for the occasional project update. */
export default function UpdatesForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "failed">("idle");
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setState("sending");
    try {
      const response = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        setError(((await response.json().catch(() => ({}))) as { error?: string }).error ?? "Something went wrong.");
        setState("failed");
        return;
      }
      void track("updates_subscribed");
      setState("done");
    } catch {
      setError("Something went wrong. Please try again.");
      setState("failed");
    }
  };

  if (state === "done") {
    return <p className="updates m-0">Thanks. You&apos;ll only hear from us when there&apos;s something new.</p>;
  }
  return (
    <form className="updates flex flex-wrap items-center gap-x-[10px] gap-y-[6px]" onSubmit={submit}>
      <label htmlFor="updates-email">Get an occasional update about the project, no spam:</label>
      <span className="inline-flex">
        <input
          id="updates-email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-[210px] max-tight:w-[170px] border border-rule bg-paper-raised px-[8px] py-[4px] font-mono text-[11px] text-ink placeholder:text-ink-soft focus:outline-none focus:border-ink"
        />
        <button
          type="submit"
          disabled={state === "sending"}
          className="border border-l-0 border-rule px-[10px] py-[4px] font-mono text-[11px] tracking-[0.04em] text-ink-soft transition-colors duration-[120ms] hover:border-ink hover:text-ink cursor-pointer disabled:opacity-60"
        >
          {state === "sending" ? "…" : "Sign up"}
        </button>
      </span>
      {state === "failed" && <span className="text-contradiction">{error}</span>}
    </form>
  );
}
