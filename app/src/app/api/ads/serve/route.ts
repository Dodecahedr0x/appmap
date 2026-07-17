import { NextRequest } from "next/server";
import { handler, ok, ApiError } from "@/lib/api";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getOrCreatePageView } from "@/lib/pageview";
import { pickWeightedAd } from "@/lib/ads";
import { revenuePerImpression } from "@/lib/revenue";

const schema = z.object({
  appId: z.string().min(1),
  path: z.string().max(300).optional(),
});

// POST /api/ads/serve — serve one ad for an app page and record the impression.
//
// The impression is attached to the visitor's page view and credited with
// revenue (cpm / 1000). That revenue accrues to the app and is later
// distributed to its stakers when the current epoch settles.
export const POST = handler(async (req: NextRequest) => {
  const body = schema.parse(await req.json());

  const app = await prisma.app.findUnique({
    where: { id: body.appId },
    select: { id: true },
  });
  if (!app) throw new ApiError("App not found", 404);

  const ads = await prisma.ad.findMany({ where: { active: true } });
  const ad = pickWeightedAd(ads);
  if (!ad) return ok({ ad: null });

  // Attach to the visitor's page view (bots get nothing).
  const pv = await getOrCreatePageView(app.id, req.headers, {
    path: body.path,
  });
  if (!pv) return ok({ ad: null, reason: "bot" });

  const revenue = revenuePerImpression(ad.cpm);
  const impression = await prisma.adImpression.create({
    data: {
      adId: ad.id,
      appId: app.id,
      pageViewId: pv.id,
      revenue,
    },
  });

  return ok({
    ad: {
      id: ad.id,
      title: ad.title,
      body: ad.body,
      imageUrl: ad.imageUrl,
      targetUrl: ad.targetUrl,
    },
    impressionId: impression.id,
  });
});
