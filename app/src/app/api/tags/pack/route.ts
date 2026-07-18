import { handler, ok } from "@/lib/api";
import { fetchTagPack } from "@/lib/indexerClient";

export const dynamic = "force-dynamic";

// GET /api/tags/pack — every approved app's full tag list plus each tag's
// global popularity, for the Explore page's Group (circle-packing) tab.
export const GET = handler(async () => {
  const pack = await fetchTagPack();
  return ok(pack);
});
