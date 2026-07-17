import { NextRequest } from "next/server";
import { handler, ok, requireUser, ApiError } from "@/lib/api";
import { buyNebSchema } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { isSimulationMode } from "@/lib/config";
import { computeBuyQuote, serializePoolStatus, type PoolState } from "@/lib/pool";

interface LockedPoolRow extends PoolState {
  id: string;
}

// POST /api/pool/buy — buy NEB off the bonding curve with SOL.
//
// Unlike vote/stake (uncapped, client-supplied amount trusted), NEB supply
// is finite, so the server ALWAYS computes tokensOut itself from the
// current DB pool state rather than trusting any client-supplied amount.
// The quote and the decrement must also be atomic with respect to OTHER
// concurrent buys, not just safe against overselling: a plain read-then-
// conditional-update (checking only `remainingSupply >= tokensOut`) would
// let two concurrent requests both quote off the same pre-trade price and
// both succeed, silently breaking the "price rises with depletion" curve
// invariant even though neither oversells. `SELECT ... FOR UPDATE` inside
// the transaction takes a row lock at read time, so a second concurrent
// buy's own `SELECT ... FOR UPDATE` blocks until the first commits and then
// sees its updated state — fully serializing buys against this one pool row.
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const body = buyNebSchema.parse(await req.json());

  const pool = await prisma.nebPool.findFirst();
  if (!pool) throw new ApiError("The NEB pool has not been seeded yet", 404);

  if (!isSimulationMode() && !body.txSig) {
    throw new ApiError("A confirmed transaction signature is required", 400);
  }

  if (body.txSig) {
    const existing = await prisma.nebPurchase.findUnique({
      where: { txSig: body.txSig },
    });
    if (existing) throw new ApiError("This transaction was already recorded", 409);
  }

  const { purchase, updatedPool } = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<LockedPoolRow[]>`
      SELECT id, "totalSupply", "remainingSupply", "solRaised", "virtualSolReserves"
      FROM "NebPool" WHERE id = ${pool.id} FOR UPDATE
    `;
    if (!locked) throw new ApiError("The NEB pool has not been seeded yet", 404);

    let tokensOut: number;
    try {
      tokensOut = computeBuyQuote(locked, body.solAmount);
    } catch (err) {
      throw new ApiError(err instanceof Error ? err.message : "Invalid trade", 400);
    }

    const updatedPool = await tx.nebPool.update({
      where: { id: locked.id },
      data: {
        remainingSupply: { decrement: tokensOut },
        solRaised: { increment: body.solAmount },
      },
    });
    const purchase = await tx.nebPurchase.create({
      data: {
        poolId: locked.id,
        userId: user.id,
        nebAmount: tokensOut,
        solAmount: body.solAmount,
        txSig: body.txSig ?? null,
      },
    });
    return { purchase, updatedPool };
  });

  return ok(
    {
      purchase: {
        id: purchase.id,
        nebAmount: purchase.nebAmount,
        solAmount: purchase.solAmount,
        txSig: purchase.txSig,
      },
      pool: serializePoolStatus(updatedPool),
    },
    { status: 201 },
  );
});
