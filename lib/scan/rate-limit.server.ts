// Per-IP rate limiting for Scan server actions, adapted from HoodMap.
// HoodMap ran on a Cloudflare Worker and used a KV namespace for a durable
// counter across isolates; this app runs as a plain Next.js server, so it
// uses HoodMap's in-memory fallback path as the only implementation. That's
// fine for a single-instance deployment — swap in a real store (Redis, a KV
// binding) if this ever runs across multiple server instances.

import { headers } from "next/headers";

const WINDOW_SECONDS = 60;

const localCounters = new Map<string, { count: number; expiresAt: number }>();

async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("cf-connecting-ip") ??
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

async function enforceRateLimit(keyPrefix: string, limit: number, message: string): Promise<void> {
  const now = Date.now();
  const windowId = Math.floor(now / (WINDOW_SECONDS * 1_000));
  const key = `${keyPrefix}:${await clientIp()}:${windowId}`;

  const existing = localCounters.get(key);
  const count = existing && existing.expiresAt > now ? existing.count + 1 : 1;
  localCounters.set(key, { count, expiresAt: now + WINDOW_SECONDS * 1_000 });
  if (localCounters.size > 2_000) {
    for (const [candidate, entry] of localCounters) {
      if (entry.expiresAt <= now) localCounters.delete(candidate);
    }
  }

  if (count > limit) throw new Error(message);
}

// Heavy per-token analysis: metadata + transfer logs + balances + clusters.
export function enforceScanRateLimit(): Promise<void> {
  return enforceRateLimit("scan", 8, "Too many scans from this IP. Please try again in a minute.");
}

// Lighter chain-wide discovery scan, but loads automatically with the page —
// allow a more generous rate so normal browsing isn't throttled.
export function enforceTrendingRateLimit(): Promise<void> {
  return enforceRateLimit(
    "trending",
    20,
    "Too many trending-token requests from this IP. Please try again in a minute.",
  );
}
