import { Connection } from "@solana/web3.js";
import { handler, ok } from "@/lib/api";
import { config } from "@/lib/config";
import { fetchNebPoolStatus } from "@/lib/dlmm";

export const dynamic = "force-dynamic";

// GET /api/pool — live NEB/USDC Meteora DLMM pool status. The pool itself is
// the source of truth (unlike the old native bonding-curve pool, which was
// our own program's account) — this just proxies a read of it server-side
// so the client doesn't need its own RPC connection for the token page.
export const GET = handler(async () => {
  const connection = new Connection(config.solana.rpc, "confirmed");
  const pool = await fetchNebPoolStatus(connection);
  return ok({ pool });
});
