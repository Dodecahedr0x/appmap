import { handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { serializePoolStatus } from "@/lib/pool";

// GET /api/pool — public read of the NEB single-sided sale pool's status.
// The DB row is the canonical source of truth in both simulation and
// on-chain mode (same "DB caches, chain settles" pattern as App's cached
// vote/stake aggregates) — see NebPool's doc comment in schema.prisma.
export const GET = handler(async () => {
  const pool = await prisma.nebPool.findFirst();
  if (!pool) return ok({ pool: null });

  return ok({ pool: serializePoolStatus(pool) });
});
