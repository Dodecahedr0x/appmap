import { prisma } from "./prisma";
import { AppStatus } from "./constants";

export interface AppGraphNode {
  id: string; // app slug
  name: string;
  stake: number;
  views: number;
  votes: number;
}

export interface AppGraphEdge {
  source: string;
  target: string;
  // Jaccard similarity of the two apps' tag sets (0..1) — plain tag overlap.
  shared: number;
  // Weighted Jaccard over each app's total stake (0..1): shared tags
  // contribute their min(stakeA, stakeB), normalized by the apps' combined
  // total stake — so two apps overlapping on a heavily-staked tag score
  // higher than two overlapping on a barely-staked one. (Plain cosine
  // similarity would NOT do this — it's scale-invariant, so it can't tell
  // a heavily-staked match from a barely-staked one.) Falls back to
  // `shared` when neither app has any stake yet.
  weighted: number;
}

export interface AppGraph {
  nodes: AppGraphNode[];
  edges: AppGraphEdge[];
}

// Cap neighbors per app so the map reads as clusters, not a hairball —
// each app keeps its strongest connections under either metric, unioned
// so switching "connect by" doesn't lose edges the other metric relied on.
const MAX_NEIGHBORS_PER_APP = 6;

/**
 * Apps clustered by tag similarity — how much their tag sets overlap, plain
 * or stake-weighted. Powers the Explore page's app map. Only apps carrying
 * at least one tag can be compared, so untagged apps are excluded; apps
 * that end up sharing tags with nothing else (after the top-K prune) are
 * dropped too, since an isolated dot has no relational insight to offer
 * here (search/browse already covers that job).
 *
 * O(n^2) tag-set comparisons — fine at catalog sizes up to a few hundred
 * apps; would need an inverted-index prefilter well beyond that.
 */
export async function buildAppGraph(): Promise<AppGraph> {
  const apps = await prisma.app.findMany({
    where: { status: AppStatus.APPROVED },
    select: {
      slug: true,
      name: true,
      stakeTotal: true,
      viewCount: true,
      voteWeight: true,
      appTags: { select: { tagId: true, stakeTotal: true } },
    },
  });

  const tagged = apps.filter((a) => a.appTags.length > 0);

  const candidates: AppGraphEdge[] = [];
  for (let i = 0; i < tagged.length; i++) {
    for (let j = i + 1; j < tagged.length; j++) {
      const a = tagged[i];
      const b = tagged[j];
      const bTags = new Map(b.appTags.map((t) => [t.tagId, t.stakeTotal]));

      let intersection = 0;
      let sumMin = 0;
      for (const t of a.appTags) {
        const stakeB = bTags.get(t.tagId);
        if (stakeB != null) {
          intersection++;
          sumMin += Math.min(t.stakeTotal, stakeB);
        }
      }
      if (intersection === 0) continue;

      const union = a.appTags.length + b.appTags.length - intersection;
      const shared = union > 0 ? intersection / union : 0;
      // a.stakeTotal/b.stakeTotal are cached aggregates kept in sync
      // elsewhere (see engine.ts) rather than derived here — clamp against
      // sumMin so a momentarily-stale cache can't push this below 0 or
      // above 1, since callers rely on `weighted` staying within that range.
      const stakeUnion = Math.max(sumMin, a.stakeTotal + b.stakeTotal - sumMin);
      const weighted = stakeUnion > 0 ? sumMin / stakeUnion : shared;

      candidates.push({ source: a.slug, target: b.slug, shared, weighted });
    }
  }

  const keepShared = topNeighborKeys(candidates, (e) => e.shared, MAX_NEIGHBORS_PER_APP);
  const keepWeighted = topNeighborKeys(candidates, (e) => e.weighted, MAX_NEIGHBORS_PER_APP);
  const edges = candidates.filter((e) => {
    const key = edgeKey(e.source, e.target);
    return keepShared.has(key) || keepWeighted.has(key);
  });

  const connected = new Set(edges.flatMap((e) => [e.source, e.target]));
  const nodes: AppGraphNode[] = tagged
    .filter((a) => connected.has(a.slug))
    .map((a) => ({ id: a.slug, name: a.name, stake: a.stakeTotal, views: a.viewCount, votes: a.voteWeight }));

  return { nodes, edges };
}

function edgeKey(source: string, target: string): string {
  return `${source}|${target}`;
}

function topNeighborKeys(
  edges: AppGraphEdge[],
  weightOf: (e: AppGraphEdge) => number,
  k: number,
): Set<string> {
  const byNode = new Map<string, { key: string; weight: number }[]>();
  for (const e of edges) {
    const key = edgeKey(e.source, e.target);
    const weight = weightOf(e);
    for (const id of [e.source, e.target]) {
      const list = byNode.get(id) ?? [];
      list.push({ key, weight });
      byNode.set(id, list);
    }
  }

  const keep = new Set<string>();
  for (const list of byNode.values()) {
    list.sort((a, b) => b.weight - a.weight);
    for (const { key } of list.slice(0, k)) keep.add(key);
  }
  return keep;
}
