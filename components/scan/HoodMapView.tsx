"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { GlassPanel } from "@/components/ui/GlassPanel";
import type { Transfer, WalletGroup, WalletNode } from "@/lib/scan/types";
import {
  assignClusterColors,
  bubbleColorCss,
  bubbleGlowCss,
  bubbleGradientCss,
  bubbleRadius,
  NEUTRAL_BUBBLE_COLOR,
  stepForceSimulation,
  type BubbleColor,
  type SimLink,
  type SimNode,
} from "@/lib/scan/hoodmap-layout";
import { cn, hashString } from "@/lib/utils";
import { WalletDetailPanel } from "@/components/scan/WalletDetailPanel";
import { BubbleLoader } from "@/components/scan/BubbleLoader";

const CANVAS_HEIGHT = 440;
const MAX_HOLDERS = 100;
const ALPHA_DECAY = 0.985;
const ALPHA_MIN = 0.01;
const MAX_TICKS = 320;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.5;
const ZOOM_STEP = 1.25;

export function HoodMapView({
  nodes,
  groups = [],
  allTransfers,
  tokenPriceUsd,
  tokenSymbol,
}: {
  nodes: WalletNode[];
  groups?: WalletGroup[];
  allTransfers: Transfer[];
  tokenPriceUsd?: number;
  tokenSymbol?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewWrapperRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Largest first so smaller bubbles draw on top (stay clickable when
  // overlapped) and pop in first, biggest holders leading the cascade.
  const topNodes = [...nodes].sort((a, b) => b.pctSupply - a.pctSupply).slice(0, MAX_HOLDERS);
  const nodeIds = topNodes.map((n) => n.id).join(",");

  // The live simulation state lives here, NOT in React state. Driving up to
  // ~60 position updates/sec through setState would re-render every one of
  // ~100 bubbles (each with nested animated layers) on every animation
  // frame for the several seconds the sim takes to settle — real, visible
  // jank, not just theoretical. Position updates during the simulation are
  // instead written straight to the DOM via refs; React only re-renders
  // when the node set changes or a bubble is selected (rare, cheap).
  const simMapRef = useRef<Map<string, SimNode>>(new Map());
  const bubbleElRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const lineElRefs = useRef<Map<string, SVGLineElement>>(new Map());
  const [ready, setReady] = useState(false);

  // Same reasoning applies to pan: dragging fires mousemove at a similar
  // rate to the sim's animation frames, so pan/zoom are also refs driving a
  // direct transform write, not React state, while a drag is in progress.
  const viewRef = useRef({ zoom: 1, panX: 0, panY: 0 });
  const [zoomPct, setZoomPct] = useState(100);
  const [isPanning, setIsPanning] = useState(false);

  function applyView() {
    const el = viewWrapperRef.current;
    if (!el) return;
    const { zoom, panX, panY } = viewRef.current;
    el.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  }

  function resetView() {
    viewRef.current = { zoom: 1, panX: 0, panY: 0 };
    applyView();
    setZoomPct(100);
  }

  function zoomBy(factor: number, center?: { x: number; y: number }) {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const cx = center?.x ?? rect.width / 2;
    const cy = center?.y ?? rect.height / 2;
    const { zoom, panX, panY } = viewRef.current;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    // Keep the point currently under (cx, cy) fixed on screen while the
    // scale changes — otherwise zooming recenters on the canvas origin
    // instead of wherever the cursor (or pinch center) actually is.
    const worldX = (cx - panX) / zoom;
    const worldY = (cy - panY) / zoom;
    viewRef.current = {
      zoom: newZoom,
      panX: cx - worldX * newZoom,
      panY: cy - worldY * newZoom,
    };
    applyView();
    setZoomPct(Math.round(newZoom * 100));
  }

  // Attached manually with { passive: false } rather than via the JSX
  // onWheel prop — passive wheel listeners silently no-op preventDefault(),
  // which would let the page scroll underneath the map while trying to
  // zoom it. Native addEventListener is the only way to guarantee that.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    function onWheelNative(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      zoomBy(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
    el.addEventListener("wheel", onWheelNative, { passive: false });
    return () => el.removeEventListener("wheel", onWheelNative);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onCanvasMouseDown(e: React.MouseEvent) {
    // Deliberately NOT gated by e.target === e.currentTarget — the view
    // wrapper covers the entire canvas (inset-0) so that check is true for
    // almost nothing, bubble or empty space alike. Instead: track from any
    // mousedown, but only start actually panning once the pointer has
    // moved past a small threshold. A real click never crosses it, and
    // since nothing here calls preventDefault/stopPropagation, the
    // browser's native click still fires normally on whatever was
    // underneath — a bubble's onClick is never touched by this at all
    // unless the user is genuinely dragging.
    const startX = e.clientX;
    const startY = e.clientY;
    const startPanX = viewRef.current.panX;
    const startPanY = viewRef.current.panY;
    let dragging = false;
    const DRAG_THRESHOLD_SQ = 16; // ~4px

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging) {
        if (dx * dx + dy * dy < DRAG_THRESHOLD_SQ) return;
        dragging = true;
        setIsPanning(true);
      }
      viewRef.current = { ...viewRef.current, panX: startPanX + dx, panY: startPanY + dy };
      applyView();
    }
    function onUp() {
      dragging = false;
      setIsPanning(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  useEffect(() => {
    const measure = () => setWidth(containerRef.current?.clientWidth ?? 0);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    if (width === 0 || topNodes.length === 0) {
      setReady(false);
      return;
    }

    resetView(); // fresh node set (new scan, or a resize) starts from a clean view

    const simNodes: SimNode[] = topNodes.map((n) => {
      const seed = hashString(n.id);
      return {
        id: n.id,
        x: width / 2 + (((seed % 200) - 100) / 100) * (width / 3),
        y: CANVAS_HEIGHT / 2 + ((((seed >> 8) % 200) - 100) / 100) * (CANVAS_HEIGHT / 3),
        vx: 0,
        vy: 0,
        r: bubbleRadius(n.pctSupply),
      };
    });
    // stepForceSimulation mutates these node objects in place, so the map
    // (used for lookups) never goes stale — no per-tick rebuild needed.
    simMapRef.current = new Map(simNodes.map((n) => [n.id, n]));
    setReady(true); // one render so bubble/line elements mount at a real starting position

    const links: SimLink[] = [];
    const byGroup = new Map<string, string[]>();
    for (const n of topNodes) {
      if (!n.group) continue;
      const arr = byGroup.get(n.group) ?? [];
      arr.push(n.id);
      byGroup.set(n.group, arr);
    }
    // Chained (a-b, b-c, c-d, …), not a star hub — matches how a reference
    // bubble map draws a cluster as a connected sequence of dots rather
    // than everything radiating from one anchor.
    for (const members of byGroup.values()) {
      if (members.length < 2) continue;
      for (let i = 0; i < members.length - 1; i++) {
        links.push({ a: members[i], b: members[i + 1] });
      }
    }

    let alpha = 1;
    let tick = 0;
    let cancelled = false;
    let raf: number;

    function applyPositions() {
      for (const n of simNodes) {
        const el = bubbleElRefs.current.get(n.id);
        if (el) {
          el.style.left = `${n.x - n.r}px`;
          el.style.top = `${n.y - n.r}px`;
        }
      }
      for (const link of links) {
        const line = lineElRefs.current.get(`${link.a}::${link.b}`);
        if (!line) continue;
        const a = simMapRef.current.get(link.a);
        const b = simMapRef.current.get(link.b);
        if (!a || !b) continue;
        line.setAttribute("x1", String(a.x));
        line.setAttribute("y1", String(a.y));
        line.setAttribute("x2", String(b.x));
        line.setAttribute("y2", String(b.y));
      }
    }

    function step() {
      if (cancelled) return;
      stepForceSimulation(simNodes, links, alpha, { width, height: CANVAS_HEIGHT });
      alpha *= ALPHA_DECAY;
      tick++;
      applyPositions();
      if (alpha > ALPHA_MIN && tick < MAX_TICKS) {
        raf = requestAnimationFrame(step);
      }
    }
    applyPositions(); // paint the seeded starting layout immediately, don't wait a frame
    raf = requestAnimationFrame(step);

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
    // nodeIds captures membership/order changes; width triggers a re-seed on resize.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, nodeIds]);

  if (nodes.length === 0) {
    return (
      <GlassPanel className="p-4">
        <div className="mb-2 text-sm font-medium text-ink">HoodMap</div>
        <p className="text-xs text-ink-faint">No holder data observed in this scan window.</p>
      </GlassPanel>
    );
  }

  const groupIds = groups.map((g) => g.id);
  const clusterColors = assignClusterColors(groupIds);
  const nodeById = new Map(topNodes.map((n) => [n.id, n]));

  // Only draw a cluster boundary/line pair when 2+ members are actually
  // rendered — a cluster whose only visible member fell inside the top-100
  // still gets its color (it's honestly still part of that cluster), it
  // just has no line to draw. Structural only — positions come from refs.
  const clusterLinkPairs: { a: string; b: string }[] = [];
  const byGroup = new Map<string, WalletNode[]>();
  for (const n of topNodes) {
    if (!n.group) continue;
    const arr = byGroup.get(n.group) ?? [];
    arr.push(n);
    byGroup.set(n.group, arr);
  }
  for (const members of byGroup.values()) {
    if (members.length < 2) continue;
    for (let i = 0; i < members.length - 1; i++) {
      clusterLinkPairs.push({ a: members[i].id, b: members[i + 1].id });
    }
  }

  const selected = selectedId ? nodeById.get(selectedId) : undefined;
  const selectedGroup = selected?.group ? groups.find((g) => g.id === selected.group) : undefined;

  return (
    <GlassPanel className="p-4">
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-medium text-ink">HoodMap</div>
        {/* A single scrollable row on narrow screens instead of wrapping —
            with up to 9 items (8 clusters + Unclustered), wrapping stacks
            them into a tall column, and items-center on the row above then
            centers the title against that whole tall block instead of
            sitting at its top like a normal header. */}
        <div className="-mx-1 flex items-center gap-2.5 overflow-x-auto px-1 text-[10px] text-ink-faint sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {groups.length === 0 ? (
            <span className="shrink-0">No wallet clusters detected</span>
          ) : (
            groups.slice(0, 8).map((g) => (
              <span key={g.id} className="flex shrink-0 items-center gap-1 whitespace-nowrap">
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{ background: bubbleColorCss(clusterColors.get(g.id)!) }}
                />
                {g.label}
              </span>
            ))
          )}
          <span className="flex shrink-0 items-center gap-1 whitespace-nowrap">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: bubbleColorCss(NEUTRAL_BUBBLE_COLOR) }}
            />
            Unclustered
          </span>
        </div>
      </div>
      <p className="mb-3 text-[11px] text-ink-faint">
        Bubbles are the holders active in the recent scan window, sized by their share of supply —
        not the full holder list (this chain has no indexer), so a quiet long-time holder may not
        appear here even if they hold a lot.
      </p>

      <div
        ref={containerRef}
        onMouseDown={onCanvasMouseDown}
        className={cn(
          "relative overflow-hidden rounded-xl bg-canvas/40",
          isPanning ? "cursor-grabbing" : "cursor-grab",
        )}
        style={{ height: CANVAS_HEIGHT, touchAction: "none" }}
      >
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center">
            <BubbleLoader label="Laying out the bubble map…" />
          </div>
        )}
        <div
          ref={viewWrapperRef}
          className="absolute inset-0"
          style={{ transformOrigin: "0 0", willChange: "transform" }}
        >
          {ready && width > 0 && (
            <svg viewBox={`0 0 ${width} ${CANVAS_HEIGHT}`} className="absolute inset-0 h-full w-full">
              <defs>
                <linearGradient id="hoodmap-link" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#D6FA4D" />
                  <stop offset="100%" stopColor="#17B04A" />
                </linearGradient>
              </defs>
              {clusterLinkPairs.map((pair) => {
                const a = simMapRef.current.get(pair.a);
                const b = simMapRef.current.get(pair.b);
                if (!a || !b) return null;
                return (
                  <line
                    key={`${pair.a}::${pair.b}`}
                    ref={(el) => {
                      const key = `${pair.a}::${pair.b}`;
                      if (el) lineElRefs.current.set(key, el);
                      else lineElRefs.current.delete(key);
                    }}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="url(#hoodmap-link)"
                    strokeOpacity={0.4}
                    strokeWidth={1}
                  />
                );
              })}
            </svg>
          )}

          {ready &&
            topNodes.map((n, i) => {
              const pos = simMapRef.current.get(n.id);
              if (!pos) return null;
              const color: BubbleColor = n.group
                ? (clusterColors.get(n.group) ?? NEUTRAL_BUBBLE_COLOR)
                : NEUTRAL_BUBBLE_COLOR;
              const isSelected = selectedId === n.id;

              // Negative delay starts each bubble already partway through its
              // idle cycle, so they read as independently drifting from the
              // first frame instead of visibly breathing in unison.
              const idleSeed = hashString(n.id);
              const idleDuration = 3.6 + (idleSeed % 30) / 10;
              const idleDelay = -(((idleSeed >> 4) % 40) / 10);
              const popDelay = Math.min(i * 9, 420);

              return (
                <button
                  key={n.id}
                  ref={(el) => {
                    if (el) bubbleElRefs.current.set(n.id, el);
                    else bubbleElRefs.current.delete(n.id);
                  }}
                  type="button"
                  onClick={() => setSelectedId(n.id)}
                  aria-label={`${n.rank != null ? `#${n.rank} ` : ""}${n.label ?? n.id} — ${n.pctSupply.toFixed(2)}% of supply`}
                  className={cn("absolute rounded-full outline-none", isSelected && "z-10")}
                  style={{
                    left: pos.x - pos.r,
                    top: pos.y - pos.r,
                    width: pos.r * 2,
                    height: pos.r * 2,
                  }}
                >
                  {/* Idle layer: perpetual gentle float, its own transform —
                      set once here, never touched again by React or the sim
                      loop, so it can never be interrupted or restarted. */}
                  <div
                    className="h-full w-full"
                    style={{
                      animation: `bubble-idle ${idleDuration}s ease-in-out infinite`,
                      animationDelay: `${idleDelay}s`,
                    }}
                  >
                    {/* Visual layer: one-time pop-in (its own transform),
                        flat-ish gradient fill + subtle colored glow,
                        hover/selection via filter + ring — neither touches
                        transform, so nothing fights the idle layer above.
                        Selected uses a clean white ring (not the brand
                        lime) — a distinct "this one" outline independent
                        of cluster color, matching a reference bubble map's
                        selection treatment. */}
                    <div
                      className={cn(
                        "h-full w-full rounded-full ring-2 ring-canvas transition-[filter] duration-150 hover:brightness-110",
                        isSelected && "ring-[3px] ring-white/85",
                      )}
                      style={{
                        background: bubbleGradientCss(color),
                        boxShadow: bubbleGlowCss(color, pos.r, isSelected ? 1.7 : 1),
                        animation: "bubble-pop 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) both",
                        animationDelay: `${popDelay}ms`,
                      }}
                    />
                  </div>
                </button>
              );
            })}
        </div>

        {/* Zoom controls — outside viewWrapperRef so they stay fixed UI
            chrome, not part of the zoomed/panned content. */}
        <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-lg border border-line bg-canvas/80 p-1 backdrop-blur">
          <button
            type="button"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
            aria-label="Zoom out"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-white/[0.08] hover:text-ink"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </button>
          <span className="w-10 text-center text-[11px] tabular-nums text-ink-faint">{zoomPct}%</span>
          <button
            type="button"
            onClick={() => zoomBy(ZOOM_STEP)}
            aria-label="Zoom in"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-white/[0.08] hover:text-ink"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </button>
          <span className="mx-0.5 h-4 w-px bg-line" />
          <button
            type="button"
            onClick={resetView}
            aria-label="Reset zoom and pan"
            title="Reset view"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-faint transition hover:bg-white/[0.08] hover:text-ink"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {selected && (
        <WalletDetailPanel
          key={selected.id}
          wallet={selected}
          group={selectedGroup}
          tokenPriceUsd={tokenPriceUsd}
          tokenSymbol={tokenSymbol}
          allTransfers={allTransfers}
          onClose={() => setSelectedId(null)}
        />
      )}
    </GlassPanel>
  );
}
