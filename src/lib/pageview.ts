import { prisma } from "./prisma";
import {
  clientIpFromHeaders,
  deriveVisitorId,
  deriveSessionId,
  looksLikeBot,
} from "./tracking";

export interface ResolvedVisitor {
  visitorId: string;
  sessionId: string;
  userAgent: string;
  isBot: boolean;
}

/** Derive the pseudonymous visitor/session identity from request headers. */
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

/**
 * Find the current session's page view for an app, creating one if none exists.
 * Shared by the tracking beacon and the ad server so an ad impression always
 * attaches to a real page view without double-counting traffic.
 *
 * Returns null for bots (which must not generate views or ad revenue).
 */
export async function getOrCreatePageView(
  appId: string,
  headers: Headers,
  opts: { path?: string; referrer?: string | null; revenueEligible?: boolean } = {},
): Promise<{ id: string; created: boolean } | null> {
  const v = resolveVisitor(headers);
  if (v.isBot) return null;

  const existing = await prisma.pageView.findFirst({
    where: { appId, visitorId: v.visitorId, sessionId: v.sessionId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const pv = await prisma.pageView.create({
    data: {
      appId,
      visitorId: v.visitorId,
      sessionId: v.sessionId,
      path: opts.path ?? "/",
      referrer: opts.referrer ?? headers.get("referer") ?? null,
      country: headers.get("x-vercel-ip-country") ?? null,
      userAgent: v.userAgent.slice(0, 300),
      revenueEligible: opts.revenueEligible ?? false,
    },
    select: { id: true },
  });
  return { id: pv.id, created: true };
}
