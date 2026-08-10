"use client";

import { useEffect, useState } from "react";
import SignIn from "@/components/SignIn";
import { initAnalytics } from "@/lib/analytics";

/**
 * Where to land afterwards, taken from `?next=`.
 *
 * Only a path on this site: a `next` of `https://elsewhere.example` or of
 * `//elsewhere.example` would turn the sign-in link in somebody's inbox into an
 * open redirect, and a login page is precisely the page worth aiming one at.
 * Anything else falls back to the front page, which is never wrong, only dull.
 */
function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

/**
 * Logging in, as a destination of its own.
 *
 * The gate at the end of a preview and the masthead both send people here, and
 * both of them sent people to the donation form before. That was the wrong ask:
 * a reader who wants this article opened has to have an account before anything
 * can be spent on their behalf, and — since an account now arrives with five
 * articles in it — an account is usually all they need. The money conversation
 * comes later, and only for somebody who has run out.
 *
 * So the blurb leads with the credit rather than with the account. It is the
 * honest reason to press the button, and it is the difference between "sign up
 * to give us money" and "sign up, here's some".
 */
export default function LogIn() {
  const [next, setNext] = useState("/");

  useEffect(() => {
    // Read on the client for the same reason `Donate` does: the server has no
    // `window`, and a value that only appears in the browser is a hydration
    // mismatch waiting to happen.
    setNext(safeNext(new URLSearchParams(window.location.search).get("next")));
    initAnalytics();
  }, []);

  return (
    <SignIn
      callbackURL={next}
      heading="Log in"
    />
  );
}
