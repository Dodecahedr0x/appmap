import { NextRequest } from "next/server";
import { handler, ok, requireUser, ApiError } from "@/lib/api";
import { unstakeSchema } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { refreshAppTag, refreshApp } from "@/lib/engine";

// POST /api/stake/withdraw — withdraw one of your active stakes.
//
// In on-chain mode the treasury would return the tokens via the program; here
// we mark the stake inactive so it stops earning revenue and boosting rank.
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const body = unstakeSchema.parse(await req.json());

  const stake = await prisma.stake.findUnique({
    where: { id: body.stakeId },
    include: { appTag: true },
  });
  if (!stake) throw new ApiError("Stake not found", 404);
  if (stake.userId !== user.id) throw new ApiError("Not your stake", 403);
  if (!stake.active) throw new ApiError("Stake already withdrawn", 409);

  await prisma.stake.update({
    where: { id: stake.id },
    data: { active: false, withdrawnAt: new Date() },
  });

  await refreshAppTag(stake.appTagId);
  await refreshApp(stake.appTag.appId);

  return ok({ withdrawn: true });
});
