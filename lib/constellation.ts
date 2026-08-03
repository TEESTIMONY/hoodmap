import type { ConnectionEdge, Person } from "@/lib/mock-data";
import { hashString } from "@/lib/utils";

export interface NodePosition {
  x: number;
  y: number;
}

const GOLDEN_ANGLE = 137.508;

/**
 * Deterministic radial layout in a 0-100 x/y space (matches an SVG
 * viewBox="0 0 100 100" 1:1, so HTML nodes positioned with left/top
 * percentages line up exactly with SVG edges drawn in the same space).
 * Direct connections to `centerId` sit in an inner ring, everyone else in
 * an outer ring — golden-angle spacing keeps it looking organic rather than
 * gridded without needing a physics simulation.
 */
export function computeConstellationLayout(
  centerId: string,
  peopleList: Person[],
  edgeList: ConnectionEdge[],
): Map<string, NodePosition> {
  const positions = new Map<string, NodePosition>();
  positions.set(centerId, { x: 50, y: 50 });

  const neighborIds = edgeList
    .filter((e) => e.from === centerId || e.to === centerId)
    .map((e) => (e.from === centerId ? e.to : e.from));
  const neighborSet = new Set(neighborIds);

  const outerIds = peopleList
    .map((p) => p.id)
    .filter((id) => id !== centerId && !neighborSet.has(id));

  placeRing(positions, neighborIds, 27, hashString(centerId) % 360);
  placeRing(positions, outerIds, 41, (hashString(centerId) % 360) + 50);

  return positions;
}

function placeRing(
  positions: Map<string, NodePosition>,
  ids: string[],
  radius: number,
  angleOffsetDeg: number,
) {
  ids.forEach((id, i) => {
    const angleDeg = angleOffsetDeg + i * GOLDEN_ANGLE;
    const angleRad = (angleDeg * Math.PI) / 180;
    const jitter = (hashString(id) % 7) - 3;
    const r = radius + jitter;
    // Rounded to avoid SSR/CSR hydration mismatches: Math.cos/sin can differ
    // in their least-significant bit between Node's and the browser's V8.
    positions.set(id, {
      x: round2(50 + r * Math.cos(angleRad)),
      y: round2(50 + r * Math.sin(angleRad)),
    });
  });
}

export function edgePath(a: NodePosition, b: NodePosition) {
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
