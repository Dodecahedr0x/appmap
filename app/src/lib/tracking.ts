import { createHash, createHmac } from "crypto";
import { config } from "./config";

// Visitor tracking is privacy-preserving: we never persist raw IP addresses.
// Instead we derive a stable, salted hash so the same visitor can be counted
// consistently for analytics and revenue attribution without being personally
// identifiable.

/**
 * Derive a stable visitor id from request fingerprint material (IP + UA).
 * Uses HMAC with the server tracking secret so the mapping cannot be reversed
 * or forged without the secret.
 */
export function deriveVisitorId(ip: string, userAgent: string): string {
  return createHmac("sha256", config.tracking.secret)
    .update(`v1:${ip}:${userAgent}`)
    .digest("hex")
    .slice(0, 32);
}

/**
 * Derive a per-session id. A session is a visitor within a coarse time window
 * (rotates roughly every 30 minutes) so repeated views in one sitting collapse
 * to one session for bot/refresh dampening.
 */
export function deriveSessionId(
  visitorId: string,
  windowMs = 30 * 60 * 1000,
): string {
  const window = Math.floor(Date.now() / windowMs);
  return createHash("sha256")
    .update(`${visitorId}:${window}`)
    .digest("hex")
    .slice(0, 24);
}

/**
 * Extract the best-effort client IP from proxy headers, falling back to a
 * placeholder. Order matters: trust the first hop we set upstream.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return (
    headers.get("x-real-ip") ||
    headers.get("cf-connecting-ip") ||
    "0.0.0.0"
  );
}

/**
 * Very small heuristic bot filter. Real deployments should use a proper bot
 * detection service; this keeps obvious crawlers out of revenue attribution.
 */
export function looksLikeBot(userAgent: string): boolean {
  if (!userAgent) return true;
  return /bot|crawl|spider|slurp|bingpreview|headless|python-requests|curl|wget/i.test(
    userAgent,
  );
}

export interface ResolvedVisitor {
  visitorId: string;
  sessionId: string;
  userAgent: string;
  isBot: boolean;
}

/**
 * Derive the pseudonymous visitor/session identity from request headers —
 * shared by the tracking beacon and the ad server (via /api/track and
 * /api/ads/serve) so both attribute traffic the same way. The indexer's
 * `/track`/`/ads/serve` endpoints trust whatever `visitorId`/`sessionId` they're
 * given rather than deriving it themselves, since that requires the tracking
 * secret and raw request headers, neither of which cross the app-indexer
 * boundary.
 */
export function resolveVisitor(headers: Headers): ResolvedVisitor {
  const userAgent = headers.get("user-agent") ?? "";
  const ip = clientIpFromHeaders(headers);
  const visitorId = deriveVisitorId(ip, userAgent);
  return {
    visitorId,
    sessionId: deriveSessionId(visitorId),
    userAgent,
    isBot: looksLikeBot(userAgent),
  };
}
