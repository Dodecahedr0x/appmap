import { prisma } from "./prisma";

export interface TagGraphNode {
  id: string;
  name: string;
  stake: number;
}

export interface TagGraphEdge {
  source: string;
  target: string;
  weight: number;
}

export interface TagGraph {
  nodes: TagGraphNode[];
  edges: TagGraphEdge[];
}

/**
 * Nodes sized by total stake across all apps; edges by co-occurrence (how
 * often two tags appear together on the same app) — a discovery path other
 * than search-by-keyword. Powers /tags.
 */
export async function buildTagGraph(): Promise<TagGraph> {
  const appTags = await prisma.appTag.findMany({
    select: { appId: true, stakeTotal: true, tag: { select: { slug: true, name: true } } },
  });

  const nodeStake = new Map<string, { name: string; stake: number }>();
  const byApp = new Map<string, string[]>();
  for (const at of appTags) {
    const entry = nodeStake.get(at.tag.slug) ?? { name: at.tag.name, stake: 0 };
    entry.stake += at.stakeTotal;
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
    nodes: [...nodeStake.entries()].map(([slug, v]) => ({ id: slug, name: v.name, stake: v.stake })),
    edges: [...edgeCounts.entries()].map(([key, weight]) => {
      const [source, target] = key.split("|") as [string, string];
      return { source, target, weight };
    }),
  };
}
