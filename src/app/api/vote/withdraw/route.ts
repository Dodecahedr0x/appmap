import { NextRequest } from "next/server";
import { handler, ok, requireUser, ApiError } from "@/lib/api";
import { unvoteSchema } from "@/lib/validation";
import { prisma } from "@/lib/prisma";
import { refreshApp } from "@/lib/engine";

// POST /api/vote/withdraw — withdraw an active vote.
//
// In on-chain mode the program returns the tokens; here we mark the vote
// inactive so it stops boosting rank and earning revenue.
export const POST = handler(async (req: NextRequest) => {
  const user = await requireUser();
  const body = unvoteSchema.parse(await req.json());

  const vote = await prisma.vote.findUnique({ where: { id: body.voteId } });
  if (!vote) throw new ApiError("Vote not found", 404);
  if (vote.userId !== user.id) throw new ApiError("Not your vote", 403);
  if (!vote.active) throw new ApiError("Vote already withdrawn", 409);

  await prisma.vote.update({
    where: { id: vote.id },
    data: { active: false, withdrawnAt: new Date() },
  });

  await refreshApp(vote.appId);

  return ok({ withdrawn: true });
});
