import { handler, ok } from "@/lib/api";
import { fetchUserXp } from "@/lib/indexerClient";
import { getSession } from "@/lib/session";

// GET /api/xp/me — the signed-in user's XP/level, or null if signed out.
// Same signed-out-returns-empty convention as /api/rewards/positions.
export const GET = handler(async () => {
  const session = await getSession();
  if (!session) return ok(null);

  const xp = await fetchUserXp(session.userId);
  return ok(xp);
});
