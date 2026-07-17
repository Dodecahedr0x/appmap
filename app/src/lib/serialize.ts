import type { App, AppTag, Tag } from "@prisma/client";
import type { AppDTO, TagDTO } from "./types";

type AppTagWithTag = AppTag & { tag: Tag };
type AppWithTags = App & { appTags: AppTagWithTag[] };

export function serializeTag(at: AppTagWithTag): TagDTO {
  return {
    id: at.id,
    tagId: at.tagId,
    slug: at.tag.slug,
    name: at.tag.name,
    stakeTotal: at.stakeTotal,
    suggestedBy: at.suggestedBy,
  };
}

export function serializeApp(app: AppWithTags): AppDTO {
  return {
    id: app.id,
    slug: app.slug,
    name: app.name,
    tagline: app.tagline,
    description: app.description,
    url: app.url,
    iconUrl: app.iconUrl,
    category: app.category,
    chain: app.chain,
    status: app.status,
    createdAt: app.createdAt.toISOString(),
    submittedBy: app.submittedBy,
    voteCount: app.voteCount,
    voteWeight: app.voteWeight,
    stakeTotal: app.stakeTotal,
    viewCount: app.viewCount,
    rankScore: app.rankScore,
    tags: (app.appTags ?? [])
      .map(serializeTag)
      .sort((a, b) => b.stakeTotal - a.stakeTotal),
  };
}

/** Prisma include clause to hydrate an app with its tags. */
export const appInclude = {
  appTags: { include: { tag: true } },
} as const;
