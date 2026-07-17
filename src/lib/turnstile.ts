const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verify a Cloudflare Turnstile response token server-side. Returns false
 * (never grants revenue eligibility) whenever a token is missing, Turnstile
 * isn't configured, or Cloudflare reports failure.
 */
export async function verifyTurnstileToken(token: string | null): Promise<boolean> {
  if (!token) return false;
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return false; // not configured (local/dev) — never grant revenue eligibility

  const res = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token }),
  });
  const json = (await res.json()) as { success: boolean };
  return json.success === true;
}
