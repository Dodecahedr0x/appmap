import { handler, ok } from "@/lib/api";
import { fetchXpActivity } from "@/lib/indexerClient";
import { getSession } from "@/lib/session";

// GET /api/xp/me/activity — the signed-in user's recent XP-earning events,
// newest first. Empty array for a signed-out visitor.
export const GET = handler(async () => {
  const session = await getSession();
  if (!session) return ok([]);

  const events = await fetchXpActivity(session.userId);
  return ok(events);
});
