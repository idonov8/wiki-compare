import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

/** Every Better Auth endpoint — sign-in, callback, session, sign-out — lands
 *  here. The handler routes on the path itself, so this file has no logic of
 *  its own and should never grow any. */
export const { GET, POST } = toNextJsHandler(auth);

// The Pool behind lib/auth.ts is a WebSocket client over `ws`, which is a Node
// module; the edge runtime has neither it nor the socket to give it.
export const runtime = "nodejs";
