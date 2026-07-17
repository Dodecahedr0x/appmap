"use client";

import { formatToken, formatNumber } from "@/lib/utils";
import { TOKEN_SYMBOL } from "@/lib/constants";
import type { TagGraphNode, TagGraphEdge } from "@/lib/tagGraph";
import { ForceMap, type MapLink, type MapNode } from "./ForceMap";

// Representative fallback so the map is never empty if the API route is
// unreachable — same shape as buildTagGraph() in src/lib/tagGraph.ts.
const FALLBACK_NODES: MapNode[] = [
  { id: "defi", label: "defi", metrics: { stake: 42000, appCount: 14 } },
  { id: "nft", label: "nft", metrics: { stake: 18500, appCount: 9 } },
  { id: "gaming", label: "gaming", metrics: { stake: 26000, appCount: 11 } },
  { id: "dao", label: "dao", metrics: { stake: 9000, appCount: 5 } },
  { id: "infrastructure", label: "infrastructure", metrics: { stake: 31000, appCount: 13 } },
  { id: "wallet", label: "wallet", metrics: { stake: 22000, appCount: 10 } },
  { id: "social", label: "social", metrics: { stake: 12500, appCount: 6 } },
  { id: "payments", label: "payments", metrics: { stake: 15800, appCount: 8 } },
  { id: "analytics", label: "analytics", metrics: { stake: 7200, appCount: 4 } },
  { id: "developer-tools", label: "developer-tools", metrics: { stake: 19600, appCount: 9 } },
  { id: "marketplace", label: "marketplace", metrics: { stake: 14300, appCount: 7 } },
];
const FALLBACK_LINKS: MapLink[] = [
  { source: "defi", target: "infrastructure", metrics: { cooccurrence: 6, similarity: 0.4 } },
  { source: "defi", target: "payments", metrics: { cooccurrence: 5, similarity: 0.35 } },
  { source: "defi", target: "analytics", metrics: { cooccurrence: 3, similarity: 0.25 } },
  { source: "nft", target: "marketplace", metrics: { cooccurrence: 5, similarity: 0.45 } },
  { source: "nft", target: "gaming", metrics: { cooccurrence: 4, similarity: 0.3 } },
  { source: "gaming", target: "wallet", metrics: { cooccurrence: 3, similarity: 0.22 } },
  { source: "wallet", target: "payments", metrics: { cooccurrence: 4, similarity: 0.3 } },
  { source: "wallet", target: "infrastructure", metrics: { cooccurrence: 3, similarity: 0.2 } },
  { source: "dao", target: "infrastructure", metrics: { cooccurrence: 2, similarity: 0.18 } },
  { source: "dao", target: "social", metrics: { cooccurrence: 3, similarity: 0.4 } },
  { source: "social", target: "marketplace", metrics: { cooccurrence: 2, similarity: 0.2 } },
  { source: "developer-tools", target: "infrastructure", metrics: { cooccurrence: 5, similarity: 0.4 } },
  { source: "developer-tools", target: "defi", metrics: { cooccurrence: 2, similarity: 0.15 } },
];

/**
 * Which tags travel together, and which ones the community has backed
 * most. Node size and link strength are both user-selectable — defaults to
 * total stake / how often two tags are used together. Click a tag to select
 * it and see apps carrying it (and its closest neighbor tags) below the map.
 */
export function TagMap({ onSelect }: { onSelect?: (node: MapNode | null, neighborIds: string[]) => void }) {
  return (
    <ForceMap<TagGraphNode, TagGraphEdge>
      fetchUrl="/api/tags/graph"
      mapNode={(n) => ({ id: n.id, label: n.name, metrics: { stake: n.stake, appCount: n.appCount } })}
      mapLink={(l) => ({ source: l.source, target: l.target, metrics: { cooccurrence: l.weight, similarity: l.similarity } })}
      fallbackNodes={FALLBACK_NODES}
      fallbackLinks={FALLBACK_LINKS}
      sourceLabel="tags"
      ariaLabel="Map of nebulous.world tags. Circle size and connection strength depend on the selected options; by default, size reflects total stake and connections show how often two tags appear on the same app. Click a tag to select it and see related apps below; drag a node to reposition, drag the background to pan, scroll to zoom."
      onSelect={onSelect}
      sizeMetrics={[
        { key: "stake", label: "Stake", format: (v) => `${formatToken(v, TOKEN_SYMBOL)} staked` },
        { key: "appCount", label: "Apps using it", format: (v) => `${formatNumber(v)} apps` },
      ]}
      linkMetrics={[
        { key: "cooccurrence", label: "Used together" },
        { key: "similarity", label: "How similar" },
      ]}
    />
  );
}
