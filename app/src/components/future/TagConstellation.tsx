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

/**
 * Force-directed tag constellation — nodes sized by total stake, edges by
 * co-occurrence. Fetches live data from /api/tags/graph and falls back to a
 * representative static graph if the request fails or returns nothing.
 */
export function TagConstellation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<"live" | "sample">("sample");

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

      const maxStake = Math.max(1, ...nodes.map((n) => n.stake));
      const radius = (n: GraphNode) => 5 + Math.sqrt(n.stake / maxStake) * 22;

      let width = 0;
      let height = 0;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
        .force("charge", forceManyBody().strength(-140))
        .force(
          "link",
          forceLink<GraphNode, GraphLink>(links)
            .id((d) => d.id)
            .distance((l) => 70 - Math.min(40, l.weight * 4))
            .strength(0.5),
        )
        .force("collide", forceCollide<GraphNode>((n) => radius(n) + 8))
        .force("center", forceCenter(0, 0))
        .alphaDecay(reduceMotion ? 1 : 0.02);

      function draw() {
        if (!ctx) return;
        ctx.clearRect(0, 0, width, height);

        ctx.lineCap = "round";
        for (const l of links) {
          const s = l.source as GraphNode;
          const t = l.target as GraphNode;
          if (s.x == null || t.x == null) continue;
          ctx.strokeStyle = `rgba(150, 180, 255, ${0.08 + Math.min(0.35, l.weight * 0.05)})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y ?? 0);
          ctx.lineTo(t.x, t.y ?? 0);
          ctx.stroke();
        }

        for (const n of nodes) {
          if (n.x == null || n.y == null) continue;
          const r = radius(n);
          const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r * 2.2);
          grad.addColorStop(0, "rgba(0, 104, 249, 0.9)");
          grad.addColorStop(1, "rgba(103, 54, 235, 0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(n.x, n.y, r * 2.2, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = "rgba(250, 249, 247, 0.95)";
          ctx.beginPath();
          ctx.arc(n.x, n.y, Math.max(2, r * 0.35), 0, Math.PI * 2);
          ctx.fill();

          ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = "rgba(250, 249, 247, 0.75)";
          ctx.textAlign = "center";
          ctx.fillText(n.name, n.x, n.y - r - 6);
        }
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

      // Drag-to-reposition.
      let dragging: GraphNode | null = null;
      function pos(e: PointerEvent) {
        const rect = canvas!.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
      }
      function onDown(e: PointerEvent) {
        const p = pos(e);
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
        if (closest) {
          dragging = closest;
          dragging.fx = dragging.x;
          dragging.fy = dragging.y;
          simulation.alphaTarget(0.3).restart();
          canvas!.setPointerCapture(e.pointerId);
        }
      }
      function onMove(e: PointerEvent) {
        if (!dragging) return;
        const p = pos(e);
        dragging.fx = p.x;
        dragging.fy = p.y;
      }
      function onUp() {
        if (!dragging) return;
        dragging.fx = null;
        dragging.fy = null;
        simulation.alphaTarget(0);
        dragging = null;
      }
      canvas.addEventListener("pointerdown", onDown);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);

      cleanup = () => {
        stopped = true;
        cancelAnimationFrame(raf);
        simulation.stop();
        io.disconnect();
        ro.disconnect();
        canvas!.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
    }

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  return (
    <div>
      <canvas
        ref={canvasRef}
        className="constellation-canvas"
        role="img"
        aria-label="Force-directed graph of nebulous.world tags, sized by total stake and linked by how often two tags share an app. Draggable, decorative beyond the summary in the caption below."
      />
      <p style={{ fontSize: "0.75rem", opacity: 0.5, marginTop: "0.5rem" }}>
        {source === "live" ? "Live from /api/tags/graph — drag a node." : "Sample graph — drag a node."}
      </p>
    </div>
  );
}
