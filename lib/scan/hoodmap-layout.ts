// Pure layout helpers for the HoodMap bubble view — no DOM, no React, so the
// highest-risk piece (bubble size scaling) can be unit tested directly.

// Bubble radius scales with sqrt(% supply) so *area*, not radius, is
// proportional to holdings — the convention real bubble maps use. A holder
// with 4x the supply reads as ~4x more visual "ink" (matching how the eye
// actually perceives size), not 16x, while the biggest holders are still
// unmistakably dominant against a 0.1% holder.
export const MIN_BUBBLE_RADIUS = 3.5;
export const MAX_BUBBLE_RADIUS = 44;

export function bubbleRadius(pctSupply: number): number {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(pctSupply) ? pctSupply : 0));
  const t = Math.sqrt(clamped) / 10; // sqrt(100) = 10 -> t = 1 at 100% supply
  return MIN_BUBBLE_RADIUS + t * (MAX_BUBBLE_RADIUS - MIN_BUBBLE_RADIUS);
}

// Colors are kept as {h,s,l} rather than pre-built CSS strings so a bubble
// can be rendered as a glassy gradient (lighter highlight, darker rim) and a
// matching colored glow, not just a flat fill — one source of truth for all
// three, instead of three separately-hand-picked colors going out of sync.
export interface BubbleColor {
  h: number;
  s: number;
  l: number;
}

// One distinct hue per cluster, evenly spaced — deterministic given the same
// (already sorted) list of group ids, so a cluster's color doesn't shuffle
// between renders. Unclustered wallets use NEUTRAL_BUBBLE_COLOR instead,
// applied by the caller, not from this map.
export const NEUTRAL_BUBBLE_COLOR: BubbleColor = { h: 222, s: 8, l: 46 };

export function assignClusterColors(groupIds: string[]): Map<string, BubbleColor> {
  const colors = new Map<string, BubbleColor>();
  const n = groupIds.length;
  groupIds.forEach((id, i) => {
    const hue = Math.round((360 / Math.max(1, n)) * i);
    colors.set(id, { h: hue, s: 68, l: 60 });
  });
  return colors;
}

export function bubbleColorCss(c: BubbleColor): string {
  return `hsl(${c.h}, ${c.s}%, ${c.l}%)`;
}

// Radial gradient with a highlight offset toward the top-left, like light
// catching the surface of a real soap bubble, fading to a darker rim.
export function bubbleGradientCss(c: BubbleColor): string {
  const light = `hsl(${c.h}, ${c.s}%, ${Math.min(94, c.l + 28)}%)`;
  const mid = bubbleColorCss(c);
  const dark = `hsl(${c.h}, ${Math.max(0, c.s - 8)}%, ${Math.max(10, c.l - 24)}%)`;
  return `radial-gradient(circle at 32% 26%, ${light} 0%, ${mid} 55%, ${dark} 100%)`;
}

export function bubbleGlowCss(c: BubbleColor, radiusPx: number, intensity = 1): string {
  // hsla(), not hsl() with a hex alpha suffix concatenated on — that trick
  // only works on #RRGGBBAA hex colors. Appending it to hsl(...) produces
  // an invalid color the browser silently drops, so the glow doesn't
  // render at all rather than rendering wrong.
  const alpha = intensity > 1 ? 0.67 : 0.33;
  const glow = `hsla(${c.h}, ${c.s}%, ${c.l}%, ${alpha})`;
  const spread = Math.max(4, radiusPx * 0.5) * intensity;
  return `0 0 ${spread}px ${glow}`;
}

export interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

export interface SimLink {
  a: string;
  b: string;
}

export interface ForceSimOptions {
  width: number;
  height: number;
  repelStrength?: number;
  linkStrength?: number;
  linkPadding?: number;
  centerStrength?: number;
  damping?: number;
}

const DEFAULTS = {
  repelStrength: 420,
  linkStrength: 0.12,
  linkPadding: 6,
  centerStrength: 0.02,
  damping: 0.82,
};

/**
 * Advances a force simulation by one tick, mutating `nodes` in place
 * (avoids per-tick allocation across up to 100 nodes x hundreds of ticks).
 * Same-cluster pairs get a spring link pulling them toward a comfortable
 * touching distance (clustered bubbles pull together); all other pairs only
 * repel (unrelated holders scatter freely). Returns nothing — callers drive
 * the loop and decide when to stop (typically via alpha decay).
 */
export function stepForceSimulation(
  nodes: SimNode[],
  links: SimLink[],
  alpha: number,
  opts: ForceSimOptions,
): void {
  const { width, height } = opts;
  const repelStrength = opts.repelStrength ?? DEFAULTS.repelStrength;
  const linkStrength = opts.linkStrength ?? DEFAULTS.linkStrength;
  const linkPadding = opts.linkPadding ?? DEFAULTS.linkPadding;
  const centerStrength = opts.centerStrength ?? DEFAULTS.centerStrength;
  const damping = opts.damping ?? DEFAULTS.damping;

  const byId = new Map(nodes.map((n) => [n.id, n]));

  // Repulsion — every pair pushes apart, stronger when overlapping.
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distSq = dx * dx + dy * dy;
      if (distSq < 0.01) {
        dx = (Math.random() - 0.5) * 0.1;
        dy = (Math.random() - 0.5) * 0.1;
        distSq = dx * dx + dy * dy;
      }
      const dist = Math.sqrt(distSq);
      const minDist = a.r + b.r + 2;
      // Falls off with distance but still felt somewhat beyond minDist, so
      // bubbles keep breathing room instead of just barely not overlapping.
      const force = (repelStrength * alpha * Math.max(minDist, 1)) / distSq;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx -= fx;
      a.vy -= fy;
      b.vx += fx;
      b.vy += fy;
    }
  }

  // Link (spring) force — pulls same-cluster pairs toward a target distance.
  for (const link of links) {
    const a = byId.get(link.a);
    const b = byId.get(link.b);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
    const target = a.r + b.r + linkPadding;
    const diff = (dist - target) * linkStrength * alpha;
    const fx = (dx / dist) * diff;
    const fy = (dy / dist) * diff;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  // Gentle centering + integrate + clamp to bounds.
  const cx = width / 2;
  const cy = height / 2;
  for (const n of nodes) {
    n.vx += (cx - n.x) * centerStrength * alpha;
    n.vy += (cy - n.y) * centerStrength * alpha;
    n.vx *= damping;
    n.vy *= damping;
    n.x = Math.min(width - n.r, Math.max(n.r, n.x + n.vx));
    n.y = Math.min(height - n.r, Math.max(n.r, n.y + n.vy));
  }
}
