"use client";

import { useEffect, useState } from "react";
import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";

interface GraphNode extends SimulationNodeDatum {
  id: string;
  name: string;
  stake: number;
}
interface GraphEdge {
  source: string;
  target: string;
  weight: number;
}

/**
 * Force-directed layout of tags: node radius scales with total stake across
 * all apps, edges connect tags that co-occur on the same app (thicker =
 * co-occur more often). A discovery path other than search-by-keyword.
 */
export function TagExplorer({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  // Starts empty (not `nodes`) so the initial render — server and
  // pre-simulation client alike — never emits an SVG transform built from
  // unset x/y (d3-force only assigns those once the simulation below runs).
  const [positioned, setPositioned] = useState<GraphNode[]>([]);
  const width = 800;
  const height = 500;

  useEffect(() => {
    // d3-force mutates node objects in place with x/y — clone so React
    // state updates trigger a re-render off a fresh array reference.
    const simNodes = nodes.map((n) => ({ ...n }));
    const sim = forceSimulation(simNodes)
      .force("charge", forceManyBody().strength(-80))
      .force(
        "link",
        forceLink<GraphNode, SimulationLinkDatum<GraphNode>>(edges as unknown as SimulationLinkDatum<GraphNode>[])
          .id((d) => d.id)
          .distance(60),
      )
      .force("center", forceCenter(width / 2, height / 2))
      .force("collide", forceCollide<GraphNode>().radius((d) => 10 + 20 * (d.stake / maxStakeOf(simNodes))))
      .stop();
    for (let i = 0; i < 300; i++) sim.tick();
    setPositioned(simNodes);
  }, [nodes, edges]);

  if (nodes.length === 0) {
    return <p className="text-sm text-slate-steel">No tags yet.</p>;
  }

  const maxStake = maxStakeOf(positioned);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="mx-auto max-w-full">
      {edges.map((e, i) => {
        const s = positioned.find((n) => n.id === e.source);
        const t = positioned.find((n) => n.id === e.target);
        if (!s || !t) return null;
        return (
          <line
            key={i}
            x1={s.x}
            y1={s.y}
            x2={t.x}
            y2={t.y}
            stroke="#cccccc"
            strokeWidth={Math.min(4, e.weight)}
          />
        );
      })}
      {positioned.map((n) => (
        <g key={n.id} transform={`translate(${n.x},${n.y})`}>
          <circle r={6 + 20 * (n.stake / maxStake)} fill="#0068f9" fillOpacity={0.85} />
          <text x={10} y={4} fontSize={11} fill="#121722">
            #{n.name}
          </text>
        </g>
      ))}
    </svg>
  );
}

function maxStakeOf(nodes: { stake: number }[]): number {
  return Math.max(1, ...nodes.map((n) => n.stake));
}
