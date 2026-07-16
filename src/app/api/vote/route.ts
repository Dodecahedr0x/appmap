import { NextRequest } from "next/server";
import { handler, ok, requireUser, ApiError } from "@/lib/api";
import { voteSchema } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { refreshApp } from "@/lib/engine";
import { isSimulationMode } from "@/lib/config";

// POST /api/vote — record a token-weighted vote for an app.
//
// In on-chain mode the client first settles an SPL transfer to the treasury and
// passes the confirmed `txSig`; we require it and enforce uniqueness so the same
// transaction can't be counted twice. In simulation mode the vote is recorded
// off-chain without a signature.
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const body = voteSchema.parse(await req.json());

  const app = await prisma.app.findUnique({ where: { id: body.appId } });
  if (!app) throw new ApiError("App not found", 404);

  if (!isSimulationMode() && !body.txSig) {
    throw new ApiError("A confirmed transaction signature is required", 400);
  }

  if (body.txSig) {
    const existing = await prisma.vote.findUnique({
      where: { txSig: body.txSig },
    });
    if (existing) throw new ApiError("This transaction was already recorded", 409);
  }

  const vote = await prisma.vote.create({
    data: {
      appId: body.appId,
      userId: user.id,
      amount: body.amount,
      txSig: body.txSig ?? null,
    },
  });

  await refreshApp(body.appId);
  const updated = await prisma.app.findUnique({
    where: { id: body.appId },
    select: { voteWeight: true, voteCount: true, rankScore: true },
  });

  return ok(
    {
      vote: { id: vote.id, amount: vote.amount, txSig: vote.txSig },
      app: updated,
    },
    { status: 201 },
  );
});
