import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

/**
 * The browser half of Better Auth.
 *
 * The plugin list has to mirror the server's, because that is how the client
 * learns which endpoints exist: without `magicLinkClient()` there is no
 * `authClient.signIn.magicLink`, and the sign-in form has nothing to call.
 *
 * No `baseURL` — the client defaults to the origin it was served from, which is
 * right in every environment we run in and, unlike a hardcoded URL, cannot point
 * a preview deployment's sign-in at production.
 */
export const authClient = createAuthClient({
  plugins: [magicLinkClient()],
});
