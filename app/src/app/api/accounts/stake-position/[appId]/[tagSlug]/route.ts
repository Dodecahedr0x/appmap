import { NextRequest } from "next/server";
import { handler, ok, ApiError } from "@/lib/api";
import { fetchStakePosition } from "@/lib/indexerClient";

export const dynamic = "force-dynamic";

// GET /api/accounts/stake-position/[appId]/[tagSlug]?owner=<pubkey> —
// decoded on-chain StakePosition for that owner, or `{ position: null }`.
export const GET = handler(
  async (req: NextRequest, ctx: { params: Promise<{ appId: string; tagSlug: string }> }) => {
    const { appId, tagSlug } = await ctx.params;
    const owner = req.nextUrl.searchParams.get("owner");
    if (!owner) throw new ApiError("owner is required", 400);
    const position = await fetchStakePosition(appId, tagSlug, owner);
    return ok({ position });
  },
);
