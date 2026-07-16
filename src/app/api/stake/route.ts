import { NextRequest } from "next/server";
import { handler, ok, requireUser, ApiError } from "@/lib/api";
import { stakeSchema } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { refreshAppTag, refreshApp } from "@/lib/engine";
import { isSimulationMode } from "@/lib/config";

// POST /api/stake — stake tokens behind an app's tag.
//
// Stake boosts the tag's weight and entitles the staker to a share of the
// app's ad revenue. On-chain mode requires a confirmed transfer signature.
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const body = stakeSchema.parse(await req.json());

  const appTag = await prisma.appTag.findUnique({
    where: { id: body.appTagId },
  });
  if (!appTag) throw new ApiError("Tag not found", 404);

  if (!isSimulationMode() && !body.txSig) {
    throw new ApiError("A confirmed transaction signature is required", 400);
  }
  if (body.txSig) {
    const existing = await prisma.stake.findUnique({
      where: { txSig: body.txSig },
    });
    if (existing) throw new ApiError("This transaction was already recorded", 409);
  }

  const stake = await prisma.stake.create({
    data: {
      appTagId: body.appTagId,
      userId: user.id,
      amount: body.amount,
      txSig: body.txSig ?? null,
      active: true,
    },
  });

  await refreshAppTag(body.appTagId);
  await refreshApp(appTag.appId);

  return ok({ stake: { id: stake.id, amount: stake.amount } }, { status: 201 });
});
