import { handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/session";

// GET /api/rewards/positions — every app/tag the current user has an active
// vote or tag stake on, across the whole platform (unlike GET /api/vote and
// GET /api/stake, which are scoped to one appId). Powers the Rewards tab's
// claim list: for each position returned here, the client derives the
// on-chain PDA and reads the pending reward directly from the chain (DB has
// no visibility into on-chain accumulator state — see lib/rewards.ts).
// Returns empty arrays for a signed-out visitor rather than 401ing, same
// convention as GET /api/vote/GET /api/stake.
export const GET = handler(async () => {
  const session = await getSession();
  if (!session) return ok({ votes: [], stakes: [] });

  const [votes, stakes] = await Promise.all([
    prisma.vote.findMany({
      where: { userId: session.userId, active: true },
      select: {
        appId: true,
        amount: true,
        app: { select: { slug: true, name: true } },
      },
    }),
    prisma.stake.findMany({
      where: { userId: session.userId, active: true },
      select: {
        appTagId: true,
        amount: true,
        appTag: {
          select: {
            appId: true,
            app: { select: { slug: true, name: true } },
            tag: { select: { slug: true, name: true } },
          },
        },
      },
    }),
  ]);

  // On-chain there's exactly one VotePosition/StakePosition per (app, user)
  // pair — its `amount` is a single running balance, not one row per vote/
  // stake transaction. The DB, however, stores one row per transaction and
  // doesn't enforce at most one active row per (app, user) (a user can vote
  // on the same app twice), so multiple active rows for the same app/tag
  // must collapse into a single aggregate position here, or the claim list
  // below would show duplicate, double-counted entries for one real
  // on-chain position.
  const voteByApp = new Map<string, { appId: string; appSlug: string; appName: string; amount: number }>();
  for (const v of votes) {
    const existing = voteByApp.get(v.appId);
    if (existing) existing.amount += v.amount;
    else voteByApp.set(v.appId, { appId: v.appId, appSlug: v.app.slug, appName: v.app.name, amount: v.amount });
  }

  const stakeByAppTag = new Map<
    string,
    { appTagId: string; appId: string; appSlug: string; appName: string; tagSlug: string; tagName: string; amount: number }
  >();
  for (const s of stakes) {
    const existing = stakeByAppTag.get(s.appTagId);
    if (existing) existing.amount += s.amount;
    else
      stakeByAppTag.set(s.appTagId, {
        appTagId: s.appTagId,
        appId: s.appTag.appId,
        appSlug: s.appTag.app.slug,
        appName: s.appTag.app.name,
        tagSlug: s.appTag.tag.slug,
        tagName: s.appTag.tag.name,
        amount: s.amount,
      });
  }

  return ok({
    votes: [...voteByApp.values()],
    stakes: [...stakeByAppTag.values()],
  });
});
