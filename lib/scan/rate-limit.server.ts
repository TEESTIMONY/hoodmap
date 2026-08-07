// Per-IP rate limiting for Scan server actions, adapted from HoodMap.
// HoodMap ran on a Cloudflare Worker and used a KV namespace for a durable
// counter across isolates.
//
// This app runs on Vercel serverless functions, which are NOT a single
// long-lived instance — concurrent or even sequential requests can land on
// different, ephemeral containers. An in-memory Map (this file's original,
// sole implementation) only "works" by accident when consecutive requests
// happen to hit the same warm lambda; under real concurrent traffic —
// exactly when a rate limit matters — each instance has its own counter
// starting from zero, so nothing is actually being enforced globally.
//
// Fix: use Upstash Redis (REST-based, purpose-built for serverless — no
// persistent connection needed) when UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN are configured. Falls back to the original
// in-memory counter when they're not, so this is safe to ship before those
// env vars exist — behavior is unchanged (same best-effort, single-instance
// limitation as before) until they're added, not broken.
import { headers } from "next/headers";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const WINDOW_SECONDS = 60;

const localCounters = new Map<string, { count: number; expiresAt: number }>();

// Lazily constructed — reading env vars at call time (not module load)
// means this keeps working correctly across the dev/build/runtime split,
// and a missing/misconfigured Redis simply falls back rather than crashing
// the module on import.
let redisLimiters: Map<string, Ratelimit> | null = null;
function getRedisLimiter(keyPrefix: string, limit: number): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  if (!redisLimiters) redisLimiters = new Map();
  const cacheKey = `${keyPrefix}:${limit}`;
  const existing = redisLimiters.get(cacheKey);
  if (existing) return existing;

  const redis = new Redis({ url, token });
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, `${WINDOW_SECONDS} s`),
    prefix: `hoodmap:${keyPrefix}`,
    analytics: false,
  });
  redisLimiters.set(cacheKey, limiter);
  return limiter;
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("cf-connecting-ip") ??
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function enforceInMemory(keyPrefix: string, ip: string, limit: number, message: string): void {
  const now = Date.now();
  const windowId = Math.floor(now / (WINDOW_SECONDS * 1_000));
  const key = `${keyPrefix}:${ip}:${windowId}`;

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

async function enforceRateLimit(keyPrefix: string, limit: number, message: string): Promise<void> {
  const ip = await clientIp();
  const redisLimiter = getRedisLimiter(keyPrefix, limit);

  if (redisLimiter) {
    try {
      const { success } = await redisLimiter.limit(ip);
      if (!success) throw new Error(message);
      return;
    } catch (err) {
      // A thrown rate-limit rejection (the `message` Error above) must
      // propagate — only an actual Redis/network failure should fall back.
      if (err instanceof Error && err.message === message) throw err;
      // Redis unreachable — degrade to the in-memory counter rather than
      // either blocking every request or silently allowing unlimited
      // traffic through with no limit at all.
      enforceInMemory(keyPrefix, ip, limit, message);
      return;
    }
  }

  enforceInMemory(keyPrefix, ip, limit, message);
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

// Wallet scan reads a wide multi-tier block window across every contract
// (two topic-filtered sweeps per tier), plus per-token metadata — heavier
// RPC volume than a single-token scan, so it gets a tighter limit.
export function enforceWalletScanRateLimit(): Promise<void> {
  return enforceRateLimit(
    "wallet-scan",
    4,
    "Too many wallet scans from this IP. Please try again in a minute.",
  );
}
