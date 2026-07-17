import { NextRequest } from "next/server";
import { handler, ok, ApiError } from "@/lib/api";
import { trackViewSchema } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { getOrCreatePageView } from "@/lib/pageview";
import { refreshApp } from "@/lib/engine";
import { verifyTurnstileToken } from "@/lib/turnstile";

// POST /api/track — record a privacy-preserving page view for an app.
//
// The visitor is pseudonymised via a salted HMAC of IP + user-agent (we never
// store raw IPs). Obvious bots are ignored and repeat views within a session
// window are deduped so traffic-based revenue attribution stays honest. A
// view only counts toward revenue-eligible traffic once its Turnstile token
// verifies server-side — everything still counts toward the (unfiltered)
// ranking view count regardless.
export const POST = handler(async (req: NextRequest) => {
  const body = trackViewSchema.parse(await req.json());

  const app = await prisma.app.findUnique({
    where: { id: body.appId },
    select: { id: true },
  });
  if (!app) throw new ApiError("App not found", 404);

  const revenueEligible = await verifyTurnstileToken(body.turnstileToken ?? null);

  const pv = await getOrCreatePageView(app.id, req.headers, {
    path: body.path,
    referrer: body.referrer,
    revenueEligible,
  });

  if (!pv) return ok({ tracked: false, reason: "bot" });
  if (!pv.created) return ok({ tracked: false, reason: "duplicate" });

  // Refresh cached view count + rank (cheap enough for demo scale).
  await refreshApp(app.id);

  return ok({ tracked: true, revenueEligible });
});
