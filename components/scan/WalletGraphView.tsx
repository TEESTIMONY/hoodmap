"use client";

import { GlassPanel } from "@/components/ui/GlassPanel";
import type { WalletEdge, WalletNode } from "@/lib/scan/types";
import { computeWalletGraphLayout } from "@/lib/scan/graph-layout";
import { ROLE_DOT_CLASS, ROLE_LABEL } from "@/lib/scan/format";
import { cn } from "@/lib/utils";

const ROLE_FILL: Record<string, string> = {
  developer: "#fbbf24",
  liquidity: "#17B04A",
  exchange: "#17B04A",
  whale: "#E6FF9E",
  holder: "#676e7a",
  sniper: "#fb7185",
  insider: "#fb7185",
  burn: "#676e7a",
  contract: "#9aa1ae",
};

export function WalletGraphView({ nodes, edges }: { nodes: WalletNode[]; edges: WalletEdge[] }) {
  if (nodes.length === 0) {
    return (
      <GlassPanel className="p-4">
        <div className="mb-2 text-sm font-medium text-ink">Wallet graph</div>
        <p className="text-xs text-ink-faint">No graph data observed in this scan window.</p>
      </GlassPanel>
    );
  }

  const positions = computeWalletGraphLayout(nodes);
  const legendRoles = Array.from(new Set(nodes.map((n) => n.role)));

  return (
    <GlassPanel className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-medium text-ink">Wallet graph</div>
        <div className="flex flex-wrap gap-2.5 text-[10px] text-ink-faint">
          {legendRoles.map((role) => (
            <span key={role} className="flex items-center gap-1">
              <span className={cn("h-1.5 w-1.5 rounded-full", ROLE_DOT_CLASS[role])} />
              {ROLE_LABEL[role]}
            </span>
          ))}
        </div>
      </div>

      <div className="relative h-80 overflow-hidden rounded-xl bg-canvas/40">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id="scan-edge" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#D6FA4D" />
              <stop offset="100%" stopColor="#17B04A" />
            </linearGradient>
          </defs>
          {edges.map((edge, i) => {
            const a = positions.get(edge.from);
            const b = positions.get(edge.to);
            if (!a || !b) return null;
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="url(#scan-edge)"
                strokeWidth={0.15 + edge.weight * 0.35}
                strokeOpacity={0.3}
              />
            );
          })}
        </svg>

        {nodes.map((n) => {
          const pos = positions.get(n.id);
          if (!pos) return null;
          const size = 10 + Math.min(18, n.pctSupply * 1.4);
          return (
            <div
              key={n.id}
              title={`${n.label ?? n.id} · ${n.pctSupply.toFixed(2)}%`}
              className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-canvas"
              style={{
                left: `${pos.x}%`,
                top: `${pos.y}%`,
                width: size,
                height: size,
                background: ROLE_FILL[n.role] ?? ROLE_FILL.holder,
              }}
            />
          );
        })}
      </div>
    </GlassPanel>
  );
}
