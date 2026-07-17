import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { fetchAppTagAccount } from "@/lib/indexerClient";

export const dynamic = "force-dynamic";

// GET /api/accounts/app-tag/[appId]/[tagSlug] — decoded on-chain
// AppTagAccount (principal vault, stake total), proxied from the indexer.
export const GET = handler(
  async (_req: NextRequest, ctx: { params: Promise<{ appId: string; tagSlug: string }> }) => {
    const { appId, tagSlug } = await ctx.params;
    const appTag = await fetchAppTagAccount(appId, tagSlug);
    return ok({ appTag });
  },
);
