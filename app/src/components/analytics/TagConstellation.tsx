"use client";

import { useEffect, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { formatToken } from "@/lib/utils";
import { TOKEN_SYMBOL } from "@/lib/constants";

interface GraphNode extends SimulationNodeDatum {
  id: string;
  name: string;
  stake: number;
}
interface GraphLink extends SimulationLinkDatum<GraphNode> {
  weight: number;
}

// Representative fallback so the graph is never empty if the API route is
// unreachable (e.g. static export, DB not seeded) — same shape as
// buildTagGraph() in src/lib/tagGraph.ts.
const FALLBACK_NODES: GraphNode[] = [
  { id: "defi", name: "defi", stake: 42000 },
  { id: "nft", name: "nft", stake: 18500 },
  { id: "gaming", name: "gaming", stake: 26000 },
  { id: "dao", name: "dao", stake: 9000 },
  { id: "infrastructure", name: "infrastructure", stake: 31000 },
  { id: "wallet", name: "wallet", stake: 22000 },
  { id: "social", name: "social", stake: 12500 },
  { id: "payments", name: "payments", stake: 15800 },
  { id: "analytics", name: "analytics", stake: 7200 },
  { id: "developer-tools", name: "developer-tools", stake: 19600 },
  { id: "marketplace", name: "marketplace", stake: 14300 },
];
const FALLBACK_LINKS: GraphLink[] = [
  { source: "defi", target: "infrastructure", weight: 6 },
  { source: "defi", target: "payments", weight: 5 },
  { source: "defi", target: "analytics", weight: 3 },
  { source: "nft", target: "marketplace", weight: 5 },
  { source: "nft", target: "gaming", weight: 4 },
  { source: "gaming", target: "wallet", weight: 3 },
  { source: "wallet", target: "payments", weight: 4 },
  { source: "wallet", target: "infrastructure", weight: 3 },
  { source: "dao", target: "infrastructure", weight: 2 },
  { source: "dao", target: "social", weight: 3 },
  { source: "social", target: "marketplace", weight: 2 },
  { source: "developer-tools", target: "infrastructure", weight: 5 },
  { source: "developer-tools", target: "defi", weight: 2 },
];

const NODE_FILL = "#0068f9";
const NODE_FILL_DIM = "#a5a5a5";
const EDGE_STROKE = "#0068f9";
const LABEL_INK = "#121722";
const LABEL_DIM = "#a5a5a5";

/**
 * Force-directed tag constellation — nodes sized by total stake, edges by
 * co-occurrence. Fetches live data from /api/tags/graph and falls back to a
 * representative static graph if the request fails or returns nothing.
 * Hovering a node highlights it and its direct connections, dimming the
 * rest of the graph; a small legend explains the size/hover encoding.
 */
export function TagConstellation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<"live" | "sample">("sample");
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  // The canvas's hover-to-highlight interaction is pointer-only (replicating
  // it via keyboard would need a whole separate nav model for what's a
  // decorative, supplementary view) — this is the WCAG-required text
  // alternative instead, giving screen reader/keyboard users the same
  // underlying data (name + stake) directly.
  const [nodeList, setNodeList] = useState<GraphNode[]>(FALLBACK_NODES);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tags/graph")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      // API responses are wrapped as { ok: true, data } by src/lib/api.ts's ok().
      .then((body: { data?: { nodes?: GraphNode[]; edges?: GraphLink[] } }) => {
        if (cancelled) return;
        const data = body.data;
        if (!data?.nodes?.length) {
          start(FALLBACK_NODES, FALLBACK_LINKS);
          return;
        }
        setSource("live");
        start(data.nodes, data.edges ?? []);
      })
      .catch(() => {
        if (!cancelled) start(FALLBACK_NODES, FALLBACK_LINKS);
      });

    let cleanup: (() => void) | undefined;

    function start(rawNodes: GraphNode[], rawLinks: GraphLink[]) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const nodes: GraphNode[] = rawNodes.map((n) => ({ ...n }));
      const nodeById = new Map(nodes.map((n) => [n.id, n]));
      const links: GraphLink[] = rawLinks
        .filter((l) => nodeById.has(String(l.source)) && nodeById.has(String(l.target)))
        .map((l) => ({ ...l }));
      setNodeList([...rawNodes].sort((a, b) => b.stake - a.stake));

      // Direct-neighbor lookup for the hover-highlight, built once per
      // dataset rather than walked on every pointer move.
      const neighbors = new Map<string, Set<string>>();
      for (const n of nodes) neighbors.set(n.id, new Set());
      for (const l of links) {
        const s = String(l.source);
        const t = String(l.target);
        neighbors.get(s)?.add(t);
        neighbors.get(t)?.add(s);
      }

      const maxStake = Math.max(1, ...nodes.map((n) => n.stake));
      const radius = (n: GraphNode) => 6 + Math.sqrt(n.stake / maxStake) * 20;

      let width = 0;
      let height = 0;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let hoveredNode: GraphNode | null = null;

      function resize() {
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        width = rect.width;
        height = rect.height;
        canvas.width = Math.max(1, Math.floor(width * dpr));
        canvas.height = Math.max(1, Math.floor(height * dpr));
        ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
        simulation.force("center", forceCenter(width / 2, height / 2));
        simulation.alpha(0.6).restart();
      }

      const simulation = forceSimulation(nodes)
        .force("charge", forceManyBody().strength(-150))
        .force(
          "link",
          forceLink<GraphNode, GraphLink>(links)
            .id((d) => d.id)
            .distance((l) => 76 - Math.min(40, l.weight * 4))
            .strength(0.5),
        )
        .force("collide", forceCollide<GraphNode>((n) => radius(n) + 10))
        .force("center", forceCenter(0, 0))
        .alphaDecay(reduceMotion ? 1 : 0.02);

      function isDimmed(id: string) {
        if (!hoveredNode) return false;
        return id !== hoveredNode.id && !neighbors.get(hoveredNode.id)?.has(id);
      }

      function draw() {
        if (!ctx) return;
        ctx.clearRect(0, 0, width, height);

        ctx.lineCap = "round";
        for (const l of links) {
          const s = l.source as GraphNode;
          const t = l.target as GraphNode;
          if (s.x == null || t.x == null) continue;
          const dim = isDimmed(s.id) || isDimmed(t.id);
          const highlighted = hoveredNode && (s.id === hoveredNode.id || t.id === hoveredNode.id);
          ctx.strokeStyle = EDGE_STROKE;
          ctx.globalAlpha = dim ? 0.05 : highlighted ? 0.5 : 0.15 + Math.min(0.25, l.weight * 0.04);
          ctx.lineWidth = highlighted ? 2 : 1;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y ?? 0);
          ctx.lineTo(t.x, t.y ?? 0);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;

        for (const n of nodes) {
          if (n.x == null || n.y == null) continue;
          const r = radius(n);
          const dim = isDimmed(n.id);
          const isHovered = hoveredNode?.id === n.id;

          ctx.globalAlpha = dim ? 0.35 : 1;
          const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 2);
          grad.addColorStop(0, dim ? "rgba(165, 165, 165, 0.35)" : "rgba(0, 104, 249, 0.28)");
          grad.addColorStop(1, "rgba(103, 54, 235, 0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r * 2, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = dim ? NODE_FILL_DIM : NODE_FILL;
          ctx.beginPath();
          ctx.arc(n.x, n.y, isHovered ? r * 0.55 : r * 0.4, 0, Math.PI * 2);
          ctx.fill();
          if (isHovered) {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2;
            ctx.stroke();
          }

          ctx.font = isHovered ? "600 12px ui-sans-serif, system-ui, sans-serif" : "11px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = dim ? LABEL_DIM : LABEL_INK;
          ctx.textAlign = "center";
          ctx.fillText(n.name, n.x, n.y - r - 6);
        }
        ctx.globalAlpha = 1;
      }

      // The simulation runs its own internal timer regardless of listeners;
      // this rAF loop just repaints from its latest node positions, for the
      // lifetime of the component (so it keeps drawing across drag-restarts
      // even after the simulation has cooled down once). Paused while the
      // canvas is scrolled off-screen.
      let raf = 0;
      let stopped = false;
      let onScreen = true;
      function paintLoop() {
        if (stopped) return;
        if (onScreen) draw();
        raf = requestAnimationFrame(paintLoop);
      }
      raf = requestAnimationFrame(paintLoop);

      const io = new IntersectionObserver((entries) => {
        onScreen = entries[0]?.isIntersecting ?? true;
      });
      io.observe(canvas);

      const ro = new ResizeObserver(resize);
      ro.observe(canvas);
      resize();

      function pos(e: PointerEvent) {
        const rect = canvas!.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
      }
      function nodeAt(p: { x: number; y: number }): GraphNode | null {
        let closest: GraphNode | null = null;
        let closestDist = Infinity;
        for (const n of nodes) {
          if (n.x == null || n.y == null) continue;
          const dist = Math.hypot(n.x - p.x, n.y - p.y);
          if (dist < radius(n) + 6 && dist < closestDist) {
            closest = n;
            closestDist = dist;
          }
        }
        return closest;
      }

      // Drag-to-reposition. Listeners live on the canvas itself, not
      // window: setPointerCapture below routes every subsequent event for
      // this pointerId to the canvas regardless of where the cursor
      // physically is, so a window-level listener (which used to run a
      // full node hit-test on every mouse move anywhere on the page, even
      // nowhere near the canvas) isn't needed for the drag to keep working
      // once the cursor leaves the canvas bounds mid-drag.
      let dragging: GraphNode | null = null;
      function onDown(e: PointerEvent) {
        const hit = nodeAt(pos(e));
        if (hit) {
          dragging = hit;
          dragging.fx = dragging.x;
          dragging.fy = dragging.y;
          simulation.alphaTarget(0.3).restart();
          canvas!.setPointerCapture(e.pointerId);
        }
      }
      function onMove(e: PointerEvent) {
        const p = pos(e);
        if (dragging) {
          dragging.fx = p.x;
          dragging.fy = p.y;
          return;
        }
        const hit = nodeAt(p);
        if (hit?.id !== hoveredNode?.id) {
          hoveredNode = hit;
          setHovered(hit);
        }
        canvas!.style.cursor = hit ? "grab" : "default";
      }
      function onUp() {
        if (!dragging) return;
        dragging.fx = null;
        dragging.fy = null;
        simulation.alphaTarget(0);
        dragging = null;
      }
      function onLeave() {
        hoveredNode = null;
        setHovered(null);
      }
      canvas.addEventListener("pointerdown", onDown);
      canvas.addEventListener("pointerleave", onLeave);
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerup", onUp);

      cleanup = () => {
        stopped = true;
        cancelAnimationFrame(raf);
        simulation.stop();
        io.disconnect();
        ro.disconnect();
        canvas!.removeEventListener("pointerdown", onDown);
        canvas!.removeEventListener("pointerleave", onLeave);
        canvas!.removeEventListener("pointermove", onMove);
        canvas!.removeEventListener("pointerup", onUp);
      };
    }

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return (
    <div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="block h-[24rem] w-full touch-none rounded-card border border-hairline bg-ivory sm:h-[30rem]"
          role="img"
          aria-label="Force-directed graph of nebulous.world tags, sized by total stake and linked by how often two tags share an app. Hover a tag to highlight its connections; drag to reposition."
        />
        {hovered && (
          <div className="pointer-events-none absolute left-3 top-3 rounded-card border border-hairline bg-white px-3 py-2 shadow-subtle">
            <div className="text-sm font-semibold text-ink">{hovered.name}</div>
            <div className="text-caption text-slate">
              {formatToken(hovered.stake, TOKEN_SYMBOL)} staked
            </div>
          </div>
        )}
      </div>
      <ul className="sr-only">
        {nodeList.map((n) => (
          <li key={n.id}>
            {n.name}: {formatToken(n.stake, TOKEN_SYMBOL)} staked
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-caption text-slate">
        <span>{source === "live" ? "Live from /api/tags/graph." : "Sample graph."} Drag a node, hover to trace connections.</span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-cobalt" aria-hidden="true" />
          size = total stake
        </span>
      </div>
    </div>
  );
}
