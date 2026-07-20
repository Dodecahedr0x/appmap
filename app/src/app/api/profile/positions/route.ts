import { handler, ok } from "@/lib/api";
import { fetchMyPositions } from "@/lib/indexerClient";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

// GET /api/profile/positions — every active vote/tag-stake the signed-in
// user holds, across every app. Powers the profile page's "My stakes" panel
// so withdrawing doesn't require finding the exact app/tag page it was
// placed on. Returns `{ positions: [] }` for a signed-out visitor rather
// than 401ing, same convention as GET /api/stake.
export const GET = handler(async () => {
  const session = await getSession();
  if (!session) return ok({ positions: [] });

  const positions = await fetchMyPositions(session.userId);
  return ok({ positions });
});
