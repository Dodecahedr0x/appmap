"use client";

import { useEffect, useRef, useState } from "react";
import { hierarchy, pack, type HierarchyCircularNode, type HierarchyNode } from "d3-hierarchy";
import { cn, formatToken, formatNumber } from "@/lib/utils";
import { TOKEN_SYMBOL } from "@/lib/constants";
import { buildTagPackTree, type PackNode, type PackTagNode, type PackAppNode } from "@/lib/tagPack";
import type { TagPack } from "@/lib/indexerClient";
import type { MapSelection } from "./RelatedApps";

// Representative fallback so the map is never empty if the API route is
// unreachable — same idea as TagMap/AppMap's FALLBACK_NODES.
const FALLBACK_PACK: TagPack = {
  tags: [
    { slug: "defi", name: "defi", appCount: 3, stake: 42000 },
    { slug: "nft", name: "nft", appCount: 2, stake: 18500 },
    { slug: "gaming", name: "gaming", appCount: 1, stake: 26000 },
    { slug: "wallet", name: "wallet", appCount: 1, stake: 22000 },
    { slug: "marketplace", name: "marketplace", appCount: 1, stake: 14300 },
  ],
  apps: [
    { slug: "jupiter", name: "Jupiter", stake: 38000, tagSlugs: ["defi"] },
    { slug: "kamino", name: "Kamino", stake: 29500, tagSlugs: ["defi", "wallet"] },
    { slug: "marinade", name: "Marinade", stake: 24100, tagSlugs: ["defi"] },
    { slug: "tensor", name: "Tensor", stake: 17600, tagSlugs: ["nft", "marketplace"] },
    { slug: "magic-eden", name: "Magic Eden", stake: 16200, tagSlugs: ["nft"] },
    { slug: "star-atlas", name: "Star Atlas", stake: 12400, tagSlugs: ["gaming"] },
  ],
};

// Same dark-map palette ForceMap uses (see DESIGN.md's nebula gradient /
// plasma blue tokens) — tag circles tint from the nebula gradient's blue
// stop toward its magenta stop as they nest deeper, app leaves get a solid
// plasma-blue dot so they always read as distinct from their container.
const TAG_FILL_SHALLOW: [number, number, number] = [50, 69, 255];
const TAG_FILL_DEEP: [number, number, number] = [184, 69, 237];
const APP_FILL = "#54b9ff";
const SELECTED_RING = "#acafff";
const LABEL_INK = "#f2f6fa";
const LABEL_DIM = "#c7cbd6";
const MAX_SIBLINGS = 6;
const MIN_LABEL_RADIUS_TAG = 20;
const MIN_LABEL_RADIUS_APP = 16;
// Pan/zoom tuning — same shape as ForceMap's view transform, adapted to a
// declarative SVG `<g>` (a CSS `transform` + `transition` pair) instead of
// an imperative canvas repaint loop, since GroupMap has no per-frame work.
const MIN_ZOOM = 0.6;
const MAX_ZOOM = 8;
const ZOOM_BUTTON_FACTOR = 1.5;
// Fraction of the viewport a zoomed-to node's diameter should fill — leaves
// a little breathing room instead of touching the edges exactly.
const FOCUS_FIT_FACTOR = 0.86;
// A pointer that moved less than this while panning still counts as a
// click (select/zoom), not a drag — same idea as ForceMap's
// CLICK_DRAG_THRESHOLD_PX.
const CLICK_DRAG_THRESHOLD_PX = 4;
// How long a wheel/drag gesture suppresses the CSS transition for, after
// the last input event — long enough that a burst of wheel ticks or a
// pointermove stream never fights the animated (click-to-zoom) case, short
// enough that letting go feels immediate rather than sluggish.
const GESTURE_SETTLE_MS = 200;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function tagFill(depth: number, maxDepth: number): string {
  const t = maxDepth > 0 ? depth / maxDepth : 0;
  const [r1, g1, b1] = TAG_FILL_SHALLOW;
  const [r2, g2, b2] = TAG_FILL_DEEP;
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgba(${r}, ${g}, ${b}, ${0.16 + t * 0.12})`;
}

type PackedNode = HierarchyCircularNode<PackNode>;
interface View {
  x: number;
  y: number;
  k: number;
}
const IDENTITY_VIEW: View = { x: 0, y: 0, k: 1 };

// A tag slug can legitimately appear at more than one depth in the tree —
// e.g. "wallet" both as its own top-level bucket (apps tagged only wallet)
// and nested under "defi" (apps tagged defi+wallet) — so `data.id` alone
// isn't a unique React key or a safe hover/selection identity. The full
// root-to-node path of ids is.
function nodeKey(n: PackedNode): string {
  return n
    .ancestors()
    .reverse()
    .map((a) => a.data.id)
    .join(">");
}

// The node one level up from `n` that's still part of the rendered tree
// (depth > 0) — i.e. where "zoom out one level" from `n` should land.
// Depth-1 nodes' parent is the synthetic root, which isn't itself
// rendered/zoomable, so that case (and the root itself) resolve to `null`,
// meaning "full view, no focus."
function parentFocusTarget(n: PackedNode): PackedNode | null {
  return n.parent && n.parent.depth > 0 ? n.parent : null;
}

function selectionFor(node: PackedNode): MapSelection | null {
  if (node.data.type === "app") {
    const app = node.data;
    const siblings = (node.parent?.children ?? [])
      .filter((c) => c.data.type === "app" && c.data.id !== app.id)
      .map((c) => (c.data as PackAppNode).id)
      .slice(0, MAX_SIBLINGS);
    return { kind: "app", label: app.name, slugs: [app.id, ...siblings], selectedSlug: app.id };
  }
  // A tag slug can appear at more than one node in the tree (e.g. "wallet"
  // both on its own and nested under "defi" — see nodeKey's comment), so
  // /api/apps/related's tagSlugs= (an OR match against every app carrying
  // that slug ANYWHERE) would over-select here, pulling in apps from a
  // sibling node that happens to share the tag but not the rest of this
  // node's ancestor path. GroupMap already knows the exact app set for this
  // circle locally — its leaves — so it resolves apps by exact slug instead
  // of asking the server to re-derive an ambiguous one. This also covers
  // the synthetic "untagged" bucket for free, which isn't a real Tag row
  // tagSlugs= could look up in the first place.
  const leafIds = node.leaves().map((l) => (l.data as PackAppNode).id);
  return leafIds.length > 0 ? { kind: "tag", label: node.data.name, slugs: leafIds } : null;
}

/**
 * Interactive D3 circle-packing view of the tag hierarchy synthesized in
 * tagPack.ts: outer circles are each app's most globally-common tag, inner
 * circles nest one tag deeper, and full (leaf) circles are individual apps.
 * Inspired by https://observablehq.com/@d3/zoomable-circle-packing. Unlike
 * AppMap/TagMap, the circles themselves have no physics step (their
 * position is deterministic from d3.pack()), so the "dynamic" part is
 * entirely a view transform layered on top: click a circle to smoothly zoom
 * in and select it (click it again, or the background, to zoom back out),
 * drag anywhere to pan, and scroll/pinch or the +/−/reset buttons to zoom —
 * the same interaction language as ForceMap's canvas maps, just driven by a
 * CSS `transform`/`transition` on a wrapping `<g>` instead of a per-frame
 * canvas repaint, since there's no simulation to redraw every tick.
 */
export function GroupMap({ onSelect }: { onSelect?: (selection: MapSelection | null) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [source, setSource] = useState<"live" | "sample">("sample");
  const [loading, setLoading] = useState(true);
  const [isEmpty, setIsEmpty] = useState(false);
  const [pkg, setPkg] = useState<TagPack>(FALLBACK_PACK);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<View>(IDENTITY_VIEW);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  // True while a wheel/drag gesture is live (or has just ended) — the `<g>`
  // skips its CSS transition then, so 1:1 pointer/wheel tracking never lags
  // behind the input, while a click-to-zoom (state-driven, no live pointer
  // to track) still animates smoothly.
  const [instant, setInstant] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const gestureTimeoutRef = useRef<number | null>(null);
  const panStartRef = useRef({ pointerX: 0, pointerY: 0, viewX: 0, viewY: 0 });
  const draggedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setIsEmpty(false);
    fetch("/api/tags/pack")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((body: { data?: TagPack }) => {
        if (cancelled) return;
        const data = body.data;
        if (!data?.apps) {
          setLoading(false);
          setSource("sample");
          setPkg(FALLBACK_PACK);
          return;
        }
        if (data.apps.length === 0) {
          setSource("live");
          setLoading(false);
          setIsEmpty(true);
          setPkg(data);
          return;
        }
        setSource("live");
        setLoading(false);
        setPkg(data);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setSource("sample");
        setPkg(FALLBACK_PACK);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A resize or a fresh dataset changes every node's x/y/r (pack() re-lays
  // out to fill the current container size), so a pan/zoom computed against
  // the old layout no longer points at anything meaningful — reset to the
  // full view rather than leave the camera aimed at empty space.
  useEffect(() => {
    setView(IDENTITY_VIEW);
    setFocusKey(null);
  }, [size.width, size.height, pkg]);

  // Native, non-passive listener so preventDefault reliably stops page
  // scroll while the cursor is over the map — React's onWheel is passive by
  // default and can't do this (same reasoning as ForceMap's onWheel).
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = svg!.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0015);
      beginInstantGesture();
      setFocusKey(null);
      setView((v) => {
        const nextK = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM);
        const applied = nextK / v.k;
        return { k: nextK, x: px - (px - v.x) * applied, y: py - (py - v.y) * applied };
      });
    }
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function beginInstantGesture() {
    setInstant(true);
    if (gestureTimeoutRef.current) window.clearTimeout(gestureTimeoutRef.current);
    gestureTimeoutRef.current = window.setTimeout(() => setInstant(false), GESTURE_SETTLE_MS);
  }

  const tree = buildTagPackTree(pkg);
  const root: PackTagNode = { type: "tag", id: "__root__", name: "", children: tree.children };
  const width = Math.max(1, size.width);
  const height = Math.max(1, size.height);
  const h = hierarchy<PackNode>(root, (d) => (d.type === "tag" ? d.children : undefined))
    .sum((d) => (d.type === "app" ? Math.max(1, d.stake) : 0))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const packed = pack<PackNode>().size([width, height]).padding(3)(h as HierarchyNode<PackNode>) as PackedNode;
  const nodes = packed.descendants().filter((d) => d.depth > 0);
  const maxDepth = nodes.reduce((m, d) => Math.max(m, d.depth), 1);
  const hovered = hoveredId ? nodes.find((n) => nodeKey(n) === hoveredId) ?? null : null;
  const leafNodes = nodes.filter((n): n is PackedNode & { data: PackAppNode } => n.data.type === "app");

  // Sets the view so `node` fills most of the viewport, or resets to the
  // full pack when `node` is null — the click-to-zoom half of the
  // interaction; drag/wheel below drive the same `view` state directly.
  function zoomToNode(node: PackedNode | null) {
    if (!node) {
      setView(IDENTITY_VIEW);
      setFocusKey(null);
      return;
    }
    const k = clamp((Math.min(width, height) / (node.r * 2)) * FOCUS_FIT_FACTOR, MIN_ZOOM, MAX_ZOOM);
    setView({ x: width / 2 - node.x * k, y: height / 2 - node.y * k, k });
    setFocusKey(nodeKey(node));
  }

  function zoomByFactor(factor: number) {
    beginInstantGesture();
    setFocusKey(null);
    setView((v) => {
      const nextK = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM);
      const applied = nextK / v.k;
      return {
        k: nextK,
        x: width / 2 - (width / 2 - v.x) * applied,
        y: height / 2 - (height / 2 - v.y) * applied,
      };
    });
  }

  function select(node: PackedNode) {
    const key = nodeKey(node);
    setSelectedId(key);
    onSelect?.(selectionFor(node));
  }

  // Click-to-zoom: clicking a circle zooms in and selects it; clicking the
  // circle that's already filling the view zooms back out one level
  // instead (and drops the selection, mirroring a background click).
  function handleNodeClick(n: PackedNode) {
    const key = nodeKey(n);
    if (focusKey === key) {
      zoomToNode(parentFocusTarget(n));
      setSelectedId(null);
      onSelect?.(null);
      return;
    }
    zoomToNode(n);
    select(n);
  }

  // Screen (client) coordinates -> the same node-space (n.x/n.y/n.r) our
  // pack layout is computed in, undoing both the SVG's own CSS→viewBox
  // scaling and our pan/zoom `view` transform.
  function screenToNodeSpace(clientX: number, clientY: number): { x: number; y: number } | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const svgX = ((clientX - rect.left) / rect.width) * width;
    const svgY = ((clientY - rect.top) / rect.height) * height;
    return { x: (svgX - view.x) / view.k, y: (svgY - view.y) / view.k };
  }

  // The deepest (most specific/innermost) node whose circle contains
  // `point` — circles nest, so a click point sitting inside a leaf app
  // circle is necessarily also inside every one of its ancestor tag
  // circles; the innermost one is the one a viewer would say they clicked.
  function nodeAtPoint(point: { x: number; y: number }): PackedNode | null {
    let best: PackedNode | null = null;
    for (const n of nodes) {
      const dx = point.x - n.x;
      const dy = point.y - n.y;
      if (dx * dx + dy * dy <= n.r * n.r && (!best || n.depth > best.depth)) best = n;
    }
    return best;
  }

  // Resolving clicks by DOM element (a native `onClick` per node circle)
  // doesn't work here: `onPointerDownPan` below calls setPointerCapture on
  // the SVG so panning keeps tracking even if the pointer leaves it
  // mid-drag, but that capture ALSO retargets the resulting synthetic
  // `click` event's target to the capturing element (the SVG) instead of
  // whatever circle was actually under the pointer — a well-known Pointer
  // Events quirk. So click resolution is done manually here, in the
  // pointerup handler, the same way ForceMap's canvas (which has no DOM
  // nodes to click at all) hit-tests its own nodes.
  function onPointerDownPan(e: React.PointerEvent<SVGSVGElement>) {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    draggedRef.current = false;
    panStartRef.current = { pointerX: e.clientX, pointerY: e.clientY, viewX: view.x, viewY: view.y };
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsPanning(true);
  }
  function onPointerMovePan(e: React.PointerEvent<SVGSVGElement>) {
    if (!isPanning) return;
    const dx = e.clientX - panStartRef.current.pointerX;
    const dy = e.clientY - panStartRef.current.pointerY;
    if (!draggedRef.current && Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD_PX) {
      draggedRef.current = true;
      setInstant(true);
      setFocusKey(null);
    }
    if (!draggedRef.current) return;
    setView((v) => ({ ...v, x: panStartRef.current.viewX + dx, y: panStartRef.current.viewY + dy }));
  }
  function onPointerUpPan(e: React.PointerEvent<SVGSVGElement>) {
    setIsPanning(false);
    if (draggedRef.current) {
      beginInstantGesture();
    } else {
      const point = screenToNodeSpace(e.clientX, e.clientY);
      const hit = point && nodeAtPoint(point);
      if (hit) {
        handleNodeClick(hit);
      } else if (selectedId || focusKey) {
        zoomToNode(null);
        setSelectedId(null);
        onSelect?.(null);
      }
    }
    // Cleared on the next tick rather than immediately so any other handler
    // still reading this gesture's outcome later in the same tick sees it.
    window.setTimeout(() => {
      draggedRef.current = false;
    }, 0);
  }

  return (
    <div>
      <div className="relative">
        <div
          ref={containerRef}
          className="relative h-[24rem] w-full overflow-hidden rounded-card border border-white/10 sm:h-[30rem]"
        >
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-label="Circle-packing map of nebulous.world tags and apps. Outer circles are the most common tags; inner circles nest one tag deeper; small filled circles are individual apps. Drag to pan, scroll or use the zoom buttons to zoom, and click a circle to zoom into it and select it."
            className={cn("touch-none select-none", isPanning ? "cursor-grabbing" : "cursor-grab")}
            onPointerDown={onPointerDownPan}
            onPointerMove={onPointerMovePan}
            onPointerUp={onPointerUpPan}
          >
            <g
              style={{
                transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
                transformOrigin: "0px 0px",
                transition: instant ? "none" : "transform 480ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              {nodes.map((n) => {
                const key = nodeKey(n);
                const isApp = n.data.type === "app";
                const isSelected = selectedId === key;
                const isHovered = hoveredId === key;
                const showLabel = isApp ? n.r >= MIN_LABEL_RADIUS_APP : n.r >= MIN_LABEL_RADIUS_TAG;
                return (
                  <g
                    key={key}
                    transform={`translate(${n.x}, ${n.y})`}
                    onPointerEnter={() => setHoveredId(key)}
                    onPointerLeave={() => setHoveredId((id) => (id === key ? null : id))}
                    className="cursor-pointer"
                  >
                    <circle
                      r={n.r}
                      fill={isApp ? APP_FILL : tagFill(n.depth, maxDepth)}
                      fillOpacity={isApp ? (isHovered || isSelected ? 0.95 : 0.75) : undefined}
                      stroke={isSelected ? SELECTED_RING : isHovered ? "#ffffff" : "rgba(255,255,255,0.15)"}
                      strokeWidth={(isSelected ? 2.5 : isHovered ? 2 : 1) / view.k}
                    />
                    {showLabel && (
                      <text
                        textAnchor="middle"
                        y={isApp ? 4 : -n.r + 14}
                        fontSize={isApp ? 11 : 12}
                        fontWeight={isApp ? 500 : 600}
                        fill={isApp ? LABEL_INK : LABEL_DIM}
                        className="pointer-events-none select-none"
                      >
                        {isApp ? n.data.name : `#${n.data.name}`}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
        {isEmpty && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center">
            <p className="text-sm text-white/50">No approved apps to group yet.</p>
          </div>
        )}
        {loading && !isEmpty && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <p className="text-sm text-white/50">Loading…</p>
          </div>
        )}
        {hovered && (
          <div className="pointer-events-none absolute left-3 top-3 max-w-[14rem] rounded-card border border-white/10 bg-black/70 px-3 py-2 backdrop-blur-sm">
            <div className="text-sm font-semibold text-white">
              {hovered.data.type === "app" ? hovered.data.name : `#${hovered.data.name}`}
            </div>
            {hovered.data.type === "app" ? (
              <div className="text-caption text-white/60">{formatToken(hovered.data.stake, TOKEN_SYMBOL)} staked</div>
            ) : (
              <div className="text-caption text-white/60">{formatNumber(hovered.leaves().length)} apps</div>
            )}
          </div>
        )}
        <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-card border border-white/10 bg-black/50 backdrop-blur-sm">
          <button
            type="button"
            onClick={() => zoomByFactor(ZOOM_BUTTON_FACTOR)}
            aria-label="Zoom in"
            className="grid h-10 w-10 place-items-center text-white/80 transition-[background-color,transform] duration-150 hover:bg-white/10 active:scale-[0.96]"
          >
            +
          </button>
          <div className="h-px bg-white/10" />
          <button
            type="button"
            onClick={() => zoomByFactor(1 / ZOOM_BUTTON_FACTOR)}
            aria-label="Zoom out"
            className="grid h-10 w-10 place-items-center text-white/80 transition-[background-color,transform] duration-150 hover:bg-white/10 active:scale-[0.96]"
          >
            −
          </button>
          <div className="h-px bg-white/10" />
          <button
            type="button"
            onClick={() => {
              zoomToNode(null);
              setSelectedId(null);
              onSelect?.(null);
            }}
            aria-label="Reset zoom and pan"
            className="grid h-10 w-10 place-items-center text-sm text-white/80 transition-[background-color,transform] duration-150 hover:bg-white/10 active:scale-[0.96]"
          >
            ⟲
          </button>
        </div>
      </div>
      <ul className="sr-only">
        {leafNodes.map((n) => (
          <li key={n.data.id}>
            {onSelect ? (
              <button type="button" onClick={() => handleNodeClick(n)}>
                {n.data.name}: {formatToken(n.data.stake, TOKEN_SYMBOL)} staked
              </button>
            ) : (
              `${n.data.name}: ${formatToken(n.data.stake, TOKEN_SYMBOL)} staked`
            )}
          </li>
        ))}
      </ul>
      <div className="mt-2 text-caption text-white/50">
        {source === "live" ? "Live tags & apps." : "Sample tags & apps."} Drag to pan, scroll to zoom, click a
        circle to zoom in and select it.
      </div>
    </div>
  );
}
