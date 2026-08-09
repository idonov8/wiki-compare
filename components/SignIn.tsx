"use client";

import { useId, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { track } from "@/lib/analytics";

/**
 * Whether to offer the Google button at all.
 *
 * The credentials themselves are secrets and cannot be read here, so this mirrors
 * them through a public flag that lib/auth.ts checks against the real ones at
 * boot and warns about if the two have drifted. Read as a literal member access
 * on `process.env` because that is the form Next inlines at build time; pulling
 * `process.env` into a variable first leaves an empty object in the browser.
 */
const GOOGLE_ENABLED = process.env.NEXT_PUBLIC_GOOGLE_ENABLED === "true";

/** The shape Better Auth hands back in `error`. Everything on it is optional,
 *  which is the whole problem this module is working around. */
type AuthError = {
  message?: string;
  status?: number;
  statusText?: string;
  code?: string;
};

/**
 * Turn a Better Auth failure into a sentence somebody can act on.
 *
 * This function is the fix for the actual reported bug. Sign-up "completely
 * didn't work" not because one 500 is unusual but because the 500 was silent:
 * the tables Better Auth writes to had never been created, every request died in
 * the adapter, and the form showed nothing at all. An error the user cannot see
 * is indistinguishable from an app that ignores them.
 *
 * So each branch names what happened and what to do next, and the caller
 * console.errors the original object alongside — the prose is for the person,
 * the object is for whoever they send the screenshot to.
 */
function describe(error: AuthError): string {
  const detail = (error.message ?? error.statusText ?? "").trim();
  const suffix = detail ? ` — ${detail}` : "";

  if (error.status === 429) {
    return "Too many sign-in attempts from here. Wait a minute, then try again.";
  }
  if (error.status === 500 || error.status === 503) {
    return (
      `The server could not finish sending the link${suffix}. Nothing was sent, so trying ` +
      "again is safe. If you are running this locally, `npm run db:init` creates the tables " +
      "sign-in needs — a fresh database has none of them."
    );
  }
  if (error.status === 400 || error.status === 422) {
    return detail || "That email address was rejected. Check it for typos and try again.";
  }
  return detail || "The sign-in request failed. The full error is in the browser console.";
}

/** The same job for a thrown exception, which is what a dead network looks like
 *  — `fetch` rejects before Better Auth ever gets to shape an error object. */
function describeThrown(cause: unknown): string {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return `Could not reach the server${detail ? ` — ${detail}` : ""}. Check your connection and try again.`;
}

/**
 * The sign-in screen.
 *
 * A whole step rather than a widget: the donate flow renders this as its first
 * page, so it owns the heading and the explanation instead of assuming something
 * above it already set the scene. The masthead keeps its own one-line form for
 * the incidental case; this is the one you land on.
 *
 * The default copy answers the question the moment actually raises. Somebody who
 * clicked "donate" did not ask for an account and is right to resent being asked
 * for one, so the blurb gives the only honest reason there is: the credit has to
 * be attached to something, and this is the cheapest something that works.
 */
export default function SignIn({
  callbackURL,
  heading = "Sign in to donate",
  blurb = "An account exists only so your credit has somewhere to live — no password, just a link in your inbox.",
}: {
  /** Where to land after a successful sign-in. Defaults to the current URL. */
  callbackURL?: string;
  /** Optional override for the screen's heading. */
  heading?: string;
  /** Optional override for the line under the heading. */
  blurb?: string;
}): React.ReactElement {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "leaving">("idle");
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const errorId = useId();

  /**
   * Resolved at click time, not at render. The default is "wherever you already
   * are", and on the server during SSR there is no such place — reading
   * `location` in the component body would break the render that has to happen
   * before anyone can click anything.
   */
  const destination = () => callbackURL ?? window.location.href;

  const busy = status === "sending" || status === "leaving";

  async function signInWithGoogle(): Promise<void> {
    if (busy) return;
    setStatus("leaving");
    setError(null);
    track("login_requested", { method: "google" });

    try {
      const { error: failure } = await authClient.signIn.social({
        provider: "google",
        callbackURL: destination(),
      });
      // Reached only when the redirect did not happen: on success the browser
      // has already left for Google and this line never runs.
      if (failure) {
        console.error("[SignIn] Google sign-in failed", failure);
        setError(describe(failure));
        setStatus("idle");
      }
    } catch (cause) {
      console.error("[SignIn] Google sign-in threw", cause);
      setError(describeThrown(cause));
      setStatus("idle");
    }
  }

  async function requestLink(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const address = email.trim();
    if (!address || busy) return;

    setStatus("sending");
    setError(null);
    track("login_requested", { method: "magic_link" });

    try {
      const { error: failure } = await authClient.signIn.magicLink({
        email: address,
        callbackURL: destination(),
      });
      if (failure) {
        console.error("[SignIn] magic link request failed", failure);
        setError(describe(failure));
        setStatus("idle");
        return;
      }
      setStatus("sent");
    } catch (cause) {
      console.error("[SignIn] magic link request threw", cause);
      setError(describeThrown(cause));
      setStatus("idle");
    }
  }

  return (
    // One narrow column, no card, nothing beside anything else. Someone who
    // arrived here wanted to give money and has been asked for an email address
    // instead; the least the screen can do is not look like a form to be
    // processed by.
    <div className="signin-screen max-w-[380px] mx-auto pt-[76px] px-[24px] pb-[96px] max-tight:pt-[48px] max-tight:px-[18px] max-tight:pb-[72px]">
      <h1 className="font-display font-normal text-[32px] leading-[1.15] tracking-[-0.01em] mb-[12px] max-tight:text-[27px]">
        {heading}
      </h1>
      <p className="signin-screen-blurb mb-[30px] text-[14.5px] leading-[1.65] text-ink-soft">{blurb}</p>

      {status === "sent" ? (
        /* Deliberately replaces the form rather than sitting under it. The next
           move is in an inbox, not on this page, and leaving a filled-in field
           and a live button here only invites sending a second link that
           invalidates the first. */
        // The offset shadow is the house signature for "this is the live thing
        // on the page", borrowed from the masthead credit panel. It is the only
        // element here that lifts off the paper, because at this point it is
        // the only element that matters.
        <div className="signin-screen-sent pt-[18px] px-[18px] pb-[16px] bg-paper-raised border border-ink rounded-[2px] shadow-offset">
          <strong className="block font-mono text-[13px] font-semibold leading-[1.5] wrap-anywhere">
            Check {email.trim()}
          </strong>
          <p className="mt-[8px] text-[13.5px] leading-[1.6] text-ink-soft">
            The link signs you in when you open it, and expires shortly after. It can take a
            minute to arrive.
          </p>
          <button
            type="button"
            className="signin-screen-again mt-[12px] p-0 border-0 bg-transparent font-mono text-[12px] text-ink-soft underline underline-offset-[3px] hover:text-ink"
            onClick={() => {
              setStatus("idle");
              setError(null);
            }}
          >
            Use a different address
          </button>
        </div>
      ) : (
        <>
          {GOOGLE_ENABLED && (
            <>
              {/* Outlined while the ink is spent on the primary action below,
                  same grammar as the donate page's toggle and amount controls:
                  outline is a choice offered, solid ink is the choice the page
                  is making for you. */}
              <button
                type="button"
                className="signin-screen-google flex items-center justify-center gap-[10px] w-full py-[12px] px-[18px] bg-paper-raised border border-ink text-[15px] text-ink enabled:hover:bg-paper disabled:opacity-[0.45] disabled:cursor-progress"
                onClick={signInWithGoogle}
                disabled={busy}
              >
                {/* Google's own mark, kept in Google's own colours — recolouring
                    it to match the paper would be the one liberty a sign-in
                    button cannot take. */}
                <GoogleMark />
                {status === "leaving" ? "Opening Google…" : "Continue with Google"}
              </button>
              {/* A rule that the word interrupts, rather than a word with two
                  rules parked beside it: the `before`/`after` line is
                  continuous underneath and the label sits in a gap it makes
                  in the paper. */}
              <div
                className="signin-screen-or flex items-center gap-[12px] my-[22px] text-ink-soft before:content-[''] before:flex-1 before:h-px before:bg-rule after:content-[''] after:flex-1 after:h-px after:bg-rule"
                role="separator"
              >
                <span className="font-mono text-[11px] tracking-[0.1em] uppercase">or</span>
              </div>
            </>
          )}

          <form
            className="signin-screen-form flex flex-col gap-[8px]"
            onSubmit={requestLink}
            noValidate
          >
            <label
              htmlFor={fieldId}
              className="font-mono text-[11px] tracking-[0.08em] uppercase text-ink-soft"
            >
              Email address
            </label>
            <input
              id={fieldId}
              type="email"
              name="email"
              value={email}
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
              required
              className="font-body text-[15px] py-[12px] px-[13px] bg-paper-raised border border-rule rounded-[2px] text-inherit placeholder:text-ink-soft aria-invalid:border-contradiction disabled:opacity-[0.55]"
            />
            <button
              type="submit"
              disabled={busy || !email.trim()}
              className="mt-[6px] py-[13px] px-[22px] bg-ink text-paper-raised border border-ink text-[15px] disabled:opacity-[0.45] disabled:cursor-not-allowed"
            >
              {status === "sending" ? "Sending…" : "Email me a link"}
            </button>
          </form>

          {/* The notice has to be at the point the address is asked for, not
              only in the footer, because this is the moment somebody decides
              whether to hand it over. Two sentences and a link: enough to say
              what happens to it, short enough to actually be read. */}
          <p className="signin-screen-notice mt-[18px] font-mono text-[11px] leading-[1.6] tracking-[0.02em] text-ink-soft">
            We keep your address to sign you in, and nothing else uses it. Delete the account and
            it goes with it —{" "}
            <a href="/privacy" className="text-ink underline underline-offset-[3px]">
              privacy
            </a>
            .
          </p>
        </>
      )}

      {/* Outside the branch above so that a failure raised while signing in with
          Google is still on screen after the form comes back. `role="alert"`
          because it appears in response to an action the reader just took and
          has to be announced, not waited for. */}
      {error && (
        // Ruled in the contradiction colour on the leading edge rather than
        // filled with it. The message is often long — it carries the server's
        // own words plus what to do about them — and a block of red would make
        // a wall of it. The rule marks it; the text stays ink and stays
        // readable.
        <p
          className="signin-screen-error mt-[20px] py-[10px] ps-[13px] border-s-2 border-contradiction text-[13.5px] leading-[1.6] text-ink"
          id={errorId}
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** Google's mark, inline. An <img> would be a network request to a third party
 *  on a page whose entire job is to be trusted with an email address. */
function GoogleMark(): React.ReactElement {
  return (
    <svg viewBox="0 0 48 48" width="17" height="17" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
      />
      <path
        fill="#EA4335"
        d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
      />
    </svg>
  );
}
