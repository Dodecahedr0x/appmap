import { NextRequest } from "next/server";
import { handler, ok } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/tags — list tags with usage + total-stake, for facets & discovery.
export const GET = handler(async (req: NextRequest) => {
  const q = req.nextUrl.searchParams.get("q")?.toLowerCase() ?? "";

  const tags = await prisma.tag.findMany({
    where: q ? { name: { contains: q } } : undefined,
    include: {
      appTags: { select: { stakeTotal: true } },
      _count: { select: { appTags: true } },
    },
  });

  const result = tags
    .map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      appCount: t._count.appTags,
      stakeTotal: t.appTags.reduce((s, at) => s + at.stakeTotal, 0),
    }))
    .sort((a, b) => b.appCount - a.appCount || b.stakeTotal - a.stakeTotal);

  return ok({ tags: result });
});
