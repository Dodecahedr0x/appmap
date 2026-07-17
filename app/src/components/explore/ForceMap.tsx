"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import { cn } from "@/lib/utils";

export interface MapNode extends SimulationNodeDatum {
  id: string;
  label: string;
  metrics: Record<string, number>;
}
export interface MapLink extends SimulationLinkDatum<MapNode> {
  metrics: Record<string, number>;
}
export interface MapMetric {
  key: string;
  label: string;
  // Only rendered for size metrics (the tooltip and sr-only list show a
  // node's size-metric values, never its link-metric ones), so link
  // metrics can omit this.
  format?: (value: number) => string;
}

interface ForceMapProps<RawNode, RawLink> {
  fetchUrl: string;
  // The API returns flat, domain-shaped records (e.g. { id, name, stake }) —
  // these adapt a fetched record into the { id, label, metrics } shape
  // ForceMap actually renders, keeping the domain types (TagGraphNode,
  // AppGraphNode, ...) as the source of truth instead of duplicating them.
  mapNode: (raw: RawNode) => MapNode;
  mapLink: (raw: RawLink) => MapLink;
  fallbackNodes: MapNode[];
  fallbackLinks: MapLink[];
  sizeMetrics: MapMetric[];
  linkMetrics: MapMetric[];
  ariaLabel: string;
  sourceLabel: string;
  onNodeClick?: (node: MapNode) => void;
}

const NODE_FILL = "#0068f9";
const NODE_FILL_DIM = "#a5a5a5";
const EDGE_STROKE = "#0068f9";
const LABEL_INK = "#121722";
const LABEL_DIM = "#a5a5a5";
// A pointer that moved less than this while a node was grabbed still counts
// as a click, not a drag — real pointers rarely stay perfectly still.
const CLICK_DRAG_THRESHOLD_PX = 4;

/**
 * Generic force-directed map: nodes sized by a chosen metric, linked by a
 * chosen metric, with hover-to-highlight, drag-to-reposition, and (if
 * `onNodeClick` is given) click-to-open. Fetches live data from `fetchUrl`
 * and falls back to a representative static graph if that fails. Shared by
 * the tag map and app map on the Explore page so the drag/hover/resize/
 * accessibility plumbing lives in exactly one place.
 */
export function ForceMap<RawNode, RawLink>({
  fetchUrl,
  mapNode,
  mapLink,
  fallbackNodes,
  fallbackLinks,
  sizeMetrics,
  linkMetrics,
  ariaLabel,
  sourceLabel,
  onNodeClick,
}: ForceMapProps<RawNode, RawLink>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [source, setSource] = useState<"live" | "sample">("sample");
  const [hovered, setHovered] = useState<MapNode | null>(null);
  // Hover-to-highlight and drag are pointer-only (replicating them via
  // keyboard would need a whole separate nav model for what's a
  // supplementary view) — this sr-only list is the WCAG text alternative,
  // giving screen reader/keyboard users the same underlying data directly.
  const [nodeList, setNodeList] = useState<MapNode[]>(fallbackNodes);
  const [showCustomize, setShowCustomize] = useState(false);
  const [sizeKey, setSizeKey] = useState(sizeMetrics[0].key);
  const [linkKey, setLinkKey] = useState(linkMetrics[0].key);
  // The fetch effect below only closes over `sizeKey`/`linkKey` as they were
  // at mount (its deps are [fetchUrl], intentionally, so a metric change
  // doesn't re-fetch/re-mount the simulation) — these refs let a metric
  // picked *while the fetch is still in flight* still apply once `start()`
  // finally runs, instead of the simulation silently initializing with the
  // stale mount-time default while the UI already shows the new selection.
  const sizeKeyRef = useRef(sizeKey);
  const linkKeyRef = useRef(linkKey);
  const applyMetricsRef = useRef<((size?: string, link?: string) => void) | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch(fetchUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      // API responses are wrapped as { ok: true, data } by src/lib/api.ts's ok().
      .then((body: { data?: { nodes?: RawNode[]; edges?: RawLink[] } }) => {
        if (cancelled) return;
        const data = body.data;
        if (!data?.nodes?.length) {
          start(fallbackNodes, fallbackLinks);
          return;
        }
        setSource("live");
        start(data.nodes.map(mapNode), (data.edges ?? []).map(mapLink));
      })
      .catch(() => {
        if (!cancelled) start(fallbackNodes, fallbackLinks);
      });

    let cleanup: (() => void) | undefined;

    function start(rawNodes: MapNode[], rawLinks: MapLink[]) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const nodes: MapNode[] = rawNodes.map((n) => ({ ...n }));
      const nodeById = new Map(nodes.map((n) => [n.id, n]));
      const links: MapLink[] = rawLinks
        .filter((l) => nodeById.has(String(l.source)) && nodeById.has(String(l.target)))
        .map((l) => ({ ...l }));

      let activeSizeKey = sizeKeyRef.current;
      let activeLinkKey = linkKeyRef.current;

      const sortKey = sizeMetrics[0].key;
      setNodeList([...rawNodes].sort((a, b) => (b.metrics[sortKey] ?? 0) - (a.metrics[sortKey] ?? 0)));

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

      let maxSize = Math.max(1, ...nodes.map((n) => n.metrics[activeSizeKey] ?? 0));
      const radius = (n: MapNode) => 6 + Math.sqrt((n.metrics[activeSizeKey] ?? 0) / maxSize) * 20;

      let maxLink = Math.max(1, ...links.map((l) => l.metrics[activeLinkKey] ?? 0));
      const distance = (l: MapLink) => {
        const w = (l.metrics[activeLinkKey] ?? 0) / maxLink;
        return 96 - Math.min(56, w * 56);
      };

      let width = 0;
      let height = 0;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let hoveredNode: MapNode | null = null;

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

      const linkForce = forceLink<MapNode, MapLink>(links).id((d) => d.id).distance(distance).strength(0.5);
      const collideForce = forceCollide<MapNode>((n) => radius(n) + 10);

      const simulation = forceSimulation(nodes)
        .force("charge", forceManyBody().strength(-150))
        .force("link", linkForce)
        .force("collide", collideForce)
        .force("center", forceCenter(0, 0))
        .alphaDecay(reduceMotion ? 1 : 0.02);

      // Re-evaluates radius/distance against the currently selected metrics
      // and re-triggers d3-force's internal recompute (calling .distance()/
      // .radius() again forces it, even with the same function reference) —
      // lets the "Customize" controls retarget a running simulation without
      // re-fetching or re-mounting anything.
      applyMetricsRef.current = (nextSize, nextLink) => {
        if (nextSize) activeSizeKey = nextSize;
        if (nextLink) activeLinkKey = nextLink;
        maxSize = Math.max(1, ...nodes.map((n) => n.metrics[activeSizeKey] ?? 0));
        maxLink = Math.max(1, ...links.map((l) => l.metrics[activeLinkKey] ?? 0));
        linkForce.distance(distance);
        collideForce.radius((n) => radius(n) + 10);
        simulation.alpha(0.7).restart();
        // Keep the sr-only list's ranking in sync with whatever "Size by"
        // is currently selected, not pinned to the metric active at load.
        if (nextSize) {
          setNodeList([...rawNodes].sort((a, b) => (b.metrics[nextSize] ?? 0) - (a.metrics[nextSize] ?? 0)));
        }
      };

      function isDimmed(id: string) {
        if (!hoveredNode) return false;
        return id !== hoveredNode.id && !neighbors.get(hoveredNode.id)?.has(id);
      }

      function draw() {
        if (!ctx) return;
        ctx.clearRect(0, 0, width, height);

        ctx.lineCap = "round";
        for (const l of links) {
          const s = l.source as MapNode;
          const t = l.target as MapNode;
          if (s.x == null || t.x == null) continue;
          const dim = isDimmed(s.id) || isDimmed(t.id);
          const highlighted = hoveredNode && (s.id === hoveredNode.id || t.id === hoveredNode.id);
          const w = (l.metrics[activeLinkKey] ?? 0) / maxLink;
          ctx.strokeStyle = EDGE_STROKE;
          ctx.globalAlpha = dim ? 0.05 : highlighted ? 0.5 : 0.15 + Math.min(0.25, w * 0.4);
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

          ctx.font = isHovered
            ? "600 12px ui-sans-serif, system-ui, sans-serif"
            : "11px ui-sans-serif, system-ui, sans-serif";
          ctx.fillStyle = dim ? LABEL_DIM : LABEL_INK;
          ctx.textAlign = "center";
          ctx.fillText(n.label, n.x, n.y - r - 6);
        }
        ctx.globalAlpha = 1;
      }

      // The simulation runs its own internal timer regardless of listeners;
      // this rAF loop just repaints from its latest node positions, for the
      // lifetime of the component. Paused while the canvas is off-screen.
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
      function nodeAt(p: { x: number; y: number }): MapNode | null {
        let closest: MapNode | null = null;
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
      // physically is, so a window-level listener isn't needed for the
      // drag to keep working once the cursor leaves the canvas mid-drag.
      let dragging: MapNode | null = null;
      let downPos: { x: number; y: number } | null = null;
      function onDown(e: PointerEvent) {
        const p = pos(e);
        const hit = nodeAt(p);
        if (hit) {
          dragging = hit;
          downPos = p;
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
        canvas!.style.cursor = hit ? (onNodeClick ? "pointer" : "grab") : "default";
      }
      function onUp(e: PointerEvent) {
        if (!dragging) return;
        const node = dragging;
        const moved = downPos ? Math.hypot(pos(e).x - downPos.x, pos(e).y - downPos.y) : Infinity;
        dragging.fx = null;
        dragging.fy = null;
        simulation.alphaTarget(0);
        dragging = null;
        downPos = null;
        if (onNodeClick && moved < CLICK_DRAG_THRESHOLD_PX) onNodeClick(node);
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
        applyMetricsRef.current = undefined;
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
    // fetchUrl is the only prop that should ever re-run the fetch/simulation
    // setup; metric selection is applied imperatively via applyMetricsRef so
    // toggling it doesn't re-fetch or restart the drag/hover listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchUrl]);

  function handleSizeChange(key: string) {
    setSizeKey(key);
    sizeKeyRef.current = key;
    applyMetricsRef.current?.(key, undefined);
  }
  function handleLinkChange(key: string) {
    setLinkKey(key);
    linkKeyRef.current = key;
    applyMetricsRef.current?.(undefined, key);
  }

  const activeSizeMetric = sizeMetrics.find((m) => m.key === sizeKey) ?? sizeMetrics[0];
  const hasOptions = sizeMetrics.length > 1 || linkMetrics.length > 1;
  const customizePanelId = useId();

  return (
    <div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="block h-[24rem] w-full touch-none rounded-card border border-hairline bg-ivory sm:h-[30rem]"
          role="img"
          aria-label={ariaLabel}
        />
        {hovered && (
          <div className="pointer-events-none absolute left-3 top-3 max-w-[14rem] rounded-card border border-hairline bg-white px-3 py-2 shadow-subtle">
            <div className="text-sm font-semibold text-ink">{hovered.label}</div>
            {sizeMetrics.map((m) => (
              <div key={m.key} className="text-caption text-slate">
                {(m.format ?? String)(hovered.metrics[m.key] ?? 0)}
              </div>
            ))}
          </div>
        )}
      </div>
      <ul className="sr-only">
        {nodeList.map((n) => {
          const summary = `${n.label}: ${sizeMetrics.map((m) => (m.format ?? String)(n.metrics[m.key] ?? 0)).join(", ")}`;
          return (
            <li key={n.id}>
              {onNodeClick ? (
                <button type="button" onClick={() => onNodeClick(n)}>
                  {summary}
                </button>
              ) : (
                summary
              )}
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-caption text-slate">
        <span>
          {source === "live" ? `Live ${sourceLabel}.` : `Sample ${sourceLabel}.`}{" "}
          {onNodeClick ? "Drag to rearrange, click to open." : "Drag to rearrange, hover to see connections."}
        </span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-cobalt" aria-hidden="true" />
            size = {activeSizeMetric.label.toLowerCase()}
          </span>
          {hasOptions && (
            <button
              type="button"
              onClick={() => setShowCustomize((v) => !v)}
              aria-expanded={showCustomize}
              aria-controls={customizePanelId}
              className="font-medium text-cobalt hover:underline"
            >
              {showCustomize ? "Hide options" : "Customize"}
            </button>
          )}
        </span>
      </div>
      {hasOptions && showCustomize && (
        <div id={customizePanelId} className="mt-3 flex flex-wrap gap-4 rounded-card border border-hairline bg-ivory p-3">
          {linkMetrics.length > 1 && (
            <div>
              <div className="text-caption font-semibold uppercase tracking-wide text-slate">Connect by</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {linkMetrics.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => handleLinkChange(m.key)}
                    aria-pressed={linkKey === m.key}
                    className={cn("chip", linkKey === m.key && "chip-active")}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {sizeMetrics.length > 1 && (
            <div>
              <div className="text-caption font-semibold uppercase tracking-wide text-slate">Size by</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {sizeMetrics.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => handleSizeChange(m.key)}
                    aria-pressed={sizeKey === m.key}
                    className={cn("chip", sizeKey === m.key && "chip-active")}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
