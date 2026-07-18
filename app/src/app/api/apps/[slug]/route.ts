import { NextRequest } from "next/server";
import { handler, ok, ApiError } from "@/lib/api";
import { fetchAppBySlug } from "@/lib/indexerClient";

export const dynamic = "force-dynamic";

// GET /api/apps/[slug] — full detail for a single app, including recent votes,
// top stakers, and traffic summary.
export const GET = handler(
  async (_req: NextRequest, ctx: { params: Promise<{ slug: string }> }) => {
    const { slug } = await ctx.params;
    const detail = await fetchAppBySlug(slug);
    if (!detail) throw new ApiError("App not found", 404);
    return ok(detail);
  },
);
