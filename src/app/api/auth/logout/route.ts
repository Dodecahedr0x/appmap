import { handler, ok } from "@/lib/api";
import { clearSessionCookie } from "@/lib/session";

// POST /api/auth/logout — clear the session cookie.
export const POST = handler(async () => {
  await clearSessionCookie();
  return ok({ signedOut: true });
});
