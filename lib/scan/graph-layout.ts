import { hashString } from "@/lib/utils";
import type { WalletNode } from "@/lib/scan/types";

export interface NodePosition {
  x: number;
  y: number;
}

const GOLDEN_ANGLE = 137.508;
const RING_RADIUS = [24, 37, 46];

/**
 * Deterministic radial layout for a token's holder graph, same approach as
 * the Constellation screen's social-graph layout (golden-angle rings in a
 * 0-100 space matching an SVG viewBox 1:1) so the two graph visualizations
 * in the app read as the same visual language. The developer wallet (or the
 * largest holder if no deployer was observed) anchors the center; everyone
 * else rings around it, biggest holders innermost.
 */
export function computeWalletGraphLayout(nodes: WalletNode[]): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  if (nodes.length === 0) return positions;

  const center = nodes.find((n) => n.role === "developer") ?? nodes[0];
  positions.set(center.id, { x: 50, y: 50 });

  const rest = [...nodes]
    .filter((n) => n.id !== center.id)
    .sort((a, b) => b.pctSupply - a.pctSupply);

  const angleSeed = hashString(center.id) % 360;
  rest.forEach((n, i) => {
    const ring = i < 8 ? 0 : i < 24 ? 1 : 2;
    const radius = RING_RADIUS[ring];
    const angleDeg = angleSeed + i * GOLDEN_ANGLE;
    const angleRad = (angleDeg * Math.PI) / 180;
    const jitter = (hashString(n.id) % 7) - 3;
    const r = radius + jitter;
    positions.set(n.id, {
      x: round2(50 + r * Math.cos(angleRad)),
      y: round2(50 + r * Math.sin(angleRad)),
    });
  });

  return positions;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
