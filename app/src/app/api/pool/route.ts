import { handler, ok } from "@/lib/api";
import { fetchPoolStatus } from "@/lib/indexerClient";

export const dynamic = "force-dynamic";

// GET /api/pool — live NEB/USDC Meteora DLMM pool status, proxied from the
// indexer (see lib/indexerClient.ts) rather than read via a direct RPC
// connection — the app no longer holds one at all.
export const GET = handler(async () => {
  const pool = await fetchPoolStatus();
  return ok({ pool });
});
