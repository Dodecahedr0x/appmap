import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { trackViewSchema } from "@/lib/validation";
import { trackPageView } from "@/lib/indexerClient";
import { resolveVisitor } from "@/lib/tracking";
import { verifyTurnstileToken } from "@/lib/turnstile";

// POST /api/track — record a privacy-preserving page view for an app.
//
// The visitor is pseudonymised via a salted HMAC of IP + user-agent (we never
// store raw IPs — see tracking.ts). Obvious bots are ignored and repeat
// views within a session window are deduped so traffic-based revenue
// attribution stays honest. A view only counts toward revenue-eligible
// traffic once its Turnstile token verifies server-side — everything still
// counts toward the (unfiltered) ranking view count regardless.
export const POST = handler(async (req: NextRequest) => {
  const body = trackViewSchema.parse(await req.json());
  const visitor = resolveVisitor(req.headers);
  if (visitor.isBot) return ok({ tracked: false, reason: "bot" });

  const revenueEligible = await verifyTurnstileToken(body.turnstileToken ?? null);

  const result = await trackPageView(
    body.appId,
    {
      visitorId: visitor.visitorId,
      sessionId: visitor.sessionId,
      userAgent: visitor.userAgent,
      path: body.path,
      referrer: body.referrer ?? req.headers.get("referer"),
    },
    revenueEligible,
  );

  return ok(result);
});
