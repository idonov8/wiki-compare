import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { Pool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

/**
 * A second connection to the same database, on a different driver.
 *
 * Better Auth runs its queries through Kysely, which expects a node-postgres
 * shaped connection — a pool with `query` and `connect` — and cannot drive the
 * tagged-template `neon()` client that lib/db.ts uses. `@neondatabase/serverless`
 * ships a compatible `Pool` alongside the HTTP client, so satisfying Kysely costs
 * a different import rather than a second database dependency. That `Pool` speaks
 * WebSockets rather than HTTP, which is the only reason `ws` and
 * `neonConfig.webSocketConstructor` appear in this file: Node has no global
 * WebSocket the driver can reach for on every runtime we deploy to.
 *
 * lib/db.ts keeps the HTTP client on purpose. Its queries are one-shot statements
 * with no transaction spanning them, which is exactly what HTTP is faster at;
 * pooling a socket per request to run a single SELECT would be the slower half of
 * this tradeoff, not the safer one.
 */
neonConfig.webSocketConstructor = ws;

export const auth = betterAuth({
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  user: {
    additionalFields: {
      /**
       * The balance lives on Better Auth's user row, but it is ours, not the
       * caller's. `input: false` is what makes that true: Better Auth exposes
       * every additional field through its own sign-up and update-user endpoints
       * unless a field opts out, so without this line anyone could POST
       * `{ creditCents: 100000 }` to /api/auth/sign-up or /api/auth/update-user
       * and mint themselves credit with a curl. Every write to these two columns
       * has to go through lib/credits.ts, which is server-only and writes them
       * with SQL that checks what it is doing.
       */
      creditCents: { type: "number", defaultValue: 0, input: false },
      peakCreditCents: { type: "number", defaultValue: 0, input: false },
    },
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, url }) => {
        await sendLoginEmail(email, url);
      },
    }),
    // Must stay last. nextCookies reads the response the rest of the chain
    // produced and forwards its Set-Cookie headers into Next's cookie store;
    // a plugin registered after it sets cookies that never reach the browser.
    nextCookies(),
  ],
});

/**
 * Sends the one link that is the entire login.
 *
 * Plain `fetch` against Resend's REST API rather than their SDK — this is one
 * POST with four fields, and an SDK for it would be a dependency whose only job
 * is to build a JSON body.
 *
 * The missing-key branch differs by environment on purpose. In development,
 * printing the link to the console is the whole local sign-in flow and needs no
 * mail provider at all. In production it throws instead, because a login email
 * that silently goes nowhere is worse than a request that fails: the person is
 * left refreshing an inbox for something that was never sent, and nothing in the
 * logs says so. A failed request at least surfaces as a failure to both of us.
 */
export async function sendLoginEmail(email: string, url: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY is not set, so the login link cannot be delivered.");
    }
    console.log(`[auth] login link for ${email}: ${url}`);
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      // Resend's shared onboarding sender, which works before any domain is
      // verified. Swap it for an address on a verified domain once there is one;
      // until then this is the difference between mail sending and mail 403ing.
      from: "wiki-compare <onboarding@resend.dev>",
      to: [email],
      subject: "Your sign-in link",
      text: `Sign in to wiki-compare:\n\n${url}\n\nIf you did not ask for this, ignore it.`,
    }),
  });

  if (!response.ok) {
    // Resend's body carries the reason the address or key was rejected, and it
    // is the only place that reason exists. Swallowing it leaves a bare 4xx.
    throw new Error(`Resend rejected the login email (${response.status}): ${await response.text()}`);
  }
}

/** The signed-in user, with our two columns, as route handlers need them. */
export type SessionUser = (typeof auth.$Infer.Session)["user"];

/**
 * Who is asking, or null.
 *
 * Every protected route needs the same three lines — read the session, tolerate
 * its absence, hand back the user — and each one that writes them itself is
 * another place where a thrown session lookup turns an anonymous visit into a
 * 500. Pass the request's own headers rather than `next/headers`, so this stays
 * callable from route handlers and from anything that already has a Request.
 */
export async function getSessionUser(headers: Headers): Promise<SessionUser | null> {
  const session = await auth.api.getSession({ headers });
  return session?.user ?? null;
}
