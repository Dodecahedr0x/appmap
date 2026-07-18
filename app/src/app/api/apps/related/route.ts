import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { fetchRelatedApps } from "@/lib/indexerClient";

// GET /api/apps/related — apps for a selected node in the Explore page's
// app/tag maps, plus that node's connected peers. Two mutually exclusive
// query shapes (never both):
//   ?slugs=jupiter,kamino        — apps matching these slugs directly (App
//                                   map: the selected app's own slug + its
//                                   neighbor apps' slugs from the graph).
//   ?tagSlugs=defi,infrastructure — apps carrying ANY of these tags (Tag
//                                   map: the selected tag's slug + its
//                                   neighbor tags' slugs) — OR semantics,
//                                   unlike the AND semantics /api/apps'
//                                   faceted search uses for multi-tag
//                                   filtering, since here we want everything
//                                   in the selected node's neighborhood, not
//                                   apps carrying every one of those tags.
export const GET = handler(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const slugs = sp.get("slugs")?.split(",").filter(Boolean) ?? [];
  const tagSlugs = sp.get("tagSlugs")?.split(",").filter(Boolean) ?? [];

  if (slugs.length === 0 && tagSlugs.length === 0) return ok({ apps: [] });

  const result = await fetchRelatedApps({ slugs, tagSlugs });
  return ok(result);
});
