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

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

/**
 * Whether Google sign-in is actually available, as opposed to merely mentioned.
 *
 * Both halves of the credential are required, and the check is what decides
 * whether the provider is registered at all. Registering `google` with an
 * undefined clientId does not fail at boot — it fails later, at the end of a
 * redirect, on Google's own error page, which is the worst possible place to
 * learn that an environment variable was never set. An unconfigured deployment
 * should have no Google button rather than a Google button that dead-ends.
 */
export const googleEnabled = !!(googleClientId && googleClientSecret);

/**
 * The browser cannot read the two variables above — they are secrets and have no
 * NEXT_PUBLIC_ prefix — so components/SignIn.tsx keys its button off
 * NEXT_PUBLIC_GOOGLE_ENABLED instead. Two variables describing one fact can
 * disagree, and the failure is silent in both directions: a button that leads
 * nowhere, or a configured provider nobody is offered. Neither is worth throwing
 * over, so this says so once at boot, where a maintainer reads logs anyway.
 */
if (process.env.NODE_ENV !== "test") {
  const advertised = process.env.NEXT_PUBLIC_GOOGLE_ENABLED === "true";
  if (advertised !== googleEnabled) {
    console.warn(
      `[auth] NEXT_PUBLIC_GOOGLE_ENABLED is ${advertised}, but Google credentials are ` +
        `${googleEnabled ? "set" : "missing"}. Set both GOOGLE_CLIENT_ID and ` +
        `GOOGLE_CLIENT_SECRET and NEXT_PUBLIC_GOOGLE_ENABLED="true", or none of them.`,
    );
  }
}

export const auth = betterAuth({
  database: new Pool({ connectionString: process.env.DATABASE_URL }),
  /**
   * Better Auth's origin check rejects any request whose Origin header is not
   * the configured baseURL (which BETTER_AUTH_URL pins to the production
   * deployment). That is correct in production and wrong everywhere else: a
   * developer on `http://localhost:3000` is told "Invalid origin" by every
   * sign-in attempt, Google and magic-link alike, because localhost is not the
   * production origin and was never trusted. Listing localhost here makes the
   * check pass locally without weakening it in production, where this entry is
   * simply never the origin of a real request.
   */
  baseURL: process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production" ? `https://${process.env.VERCEL_URL}` : process.env.BETTER_AUTH_URL,
  trustedOrigins: ["http://localhost:3000", "http://127.0.0.1:3000"],
  socialProviders: {
    // Spread rather than a `google: undefined` key: Better Auth treats the
    // presence of the key as the registration, so the provider has to be absent
    // from the object entirely, not present and empty.
    ...(googleEnabled
      ? { google: { clientId: googleClientId!, clientSecret: googleClientSecret! } }
      : {}),
  },
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
 *
 * The discriminator is VERCEL_ENV, not NODE_ENV, and the difference is not
 * cosmetic. Vercel builds preview deployments with NODE_ENV="production" — that
 * is what makes them a faithful build of production — so keying on NODE_ENV made
 * every preview throw on every sign-in attempt, which is exactly the environment
 * where nobody has bothered to set a mail key and where printing the link to the
 * build log is the intended flow. VERCEL_ENV is the variable that actually
 * distinguishes "production" from "preview" and "development", so only a real
 * production deployment refuses to swallow the failure. Off Vercel it is unset,
 * which lands on the console branch — right for local `next dev` and for CI.
 */
export async function sendLoginEmail(email: string, url: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    if (process.env.VERCEL_ENV === "production") {
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
