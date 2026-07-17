import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { fetchBalance } from "@/lib/indexerClient";

export const dynamic = "force-dynamic";

// GET /api/balances/[owner]/[mint] — the owner's SPL token balance for that
// mint, proxied from the indexer instead of a direct
// `connection.getTokenAccountBalance()` call.
export const GET = handler(
  async (_req: NextRequest, ctx: { params: Promise<{ owner: string; mint: string }> }) => {
    const { owner, mint } = await ctx.params;
    const balance = await fetchBalance(owner, mint);
    return ok(balance);
  },
);
