import { prisma } from "./prisma";
import { AppStatus } from "./constants";

export interface TagGraphNode {
  id: string;
  name: string;
  stake: number;
  // Number of approved apps carrying this tag — an alternate, stake-free
  // way to size the map (popularity of the label vs. capital behind it).
  appCount: number;
}

export interface TagGraphEdge {
  source: string;
  target: string;
  weight: number;
  // Jaccard similarity of the two tags' app sets (0..1): how much of each
  // tag's usage overlaps with the other, independent of raw popularity —
  // two rarely-used tags that always appear together score high here even
  // though their co-occurrence `weight` is small.
  similarity: number;
}

export interface TagGraph {
  nodes: TagGraphNode[];
  edges: TagGraphEdge[];
}

/**
 * Nodes sized by total stake (or app count) across approved apps; edges by
 * co-occurrence or similarity — how tags relate to one another. Powers
 * /tags and the Explore page's tag map.
 */
export async function buildTagGraph(): Promise<TagGraph> {
  const appTags = await prisma.appTag.findMany({
    where: { app: { status: AppStatus.APPROVED } },
    select: { appId: true, stakeTotal: true, tag: { select: { slug: true, name: true } } },
  });

  const nodeStake = new Map<string, { name: string; stake: number; appCount: number }>();
  const byApp = new Map<string, string[]>();
  for (const at of appTags) {
    const entry = nodeStake.get(at.tag.slug) ?? { name: at.tag.name, stake: 0, appCount: 0 };
    entry.stake += at.stakeTotal;
    entry.appCount += 1;
    nodeStake.set(at.tag.slug, entry);
    byApp.set(at.appId, [...(byApp.get(at.appId) ?? []), at.tag.slug]);
  }

  const edgeCounts = new Map<string, number>();
  for (const tags of byApp.values()) {
    for (let i = 0; i < tags.length; i++) {
      for (let j = i + 1; j < tags.length; j++) {
        const key = [tags[i], tags[j]].sort().join("|");
        edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      }
    }
  }

  return {
    nodes: [...nodeStake.entries()].map(([slug, v]) => ({
      id: slug,
      name: v.name,
      stake: v.stake,
      appCount: v.appCount,
    })),
    edges: [...edgeCounts.entries()].map(([key, weight]) => {
      const [source, target] = key.split("|") as [string, string];
      const countA = nodeStake.get(source)?.appCount ?? 0;
      const countB = nodeStake.get(target)?.appCount ?? 0;
      const union = countA + countB - weight;
      return { source, target, weight, similarity: union > 0 ? weight / union : 0 };
    }),
  };
}
