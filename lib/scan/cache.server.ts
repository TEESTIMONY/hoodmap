// Shared read-through cache for expensive per-request work (full token/
// wallet scans, DexScreener lookups, chain-wide discovery). None of this
// app's scan pipeline is cached today — two users scanning the same token
// seconds apart trigger two fully independent RPC sweeps. That's the
// single biggest lever for making the app feel fast and for cutting
// redundant RPC/DexScreener load as traffic grows.
//
// Same infra, same safety pattern as rate-limit.server.ts: Upstash Redis
// (already added for rate limiting) when UPSTASH_REDIS_REST_URL /
// UPSTASH_REDIS_REST_TOKEN are configured, otherwise every call is a
// pass-through to `compute()` with no caching at all — identical to this
// app's current (uncached) behavior. Safe to ship before those env vars
// exist; a Redis outage or missing config degrades to "always fresh," not
// to an error.
import { Redis } from "@upstash/redis";

let redisClient: Redis | null | undefined; // undefined = not yet checked
function getRedis(): Redis | null {
  if (redisClient !== undefined) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  redisClient = url && token ? new Redis({ url, token }) : null;
  return redisClient;
}

/**
 * Read-through cache: returns the cached value for `key` if present and
 * unexpired, otherwise calls `compute()`, stores the result with `ttlSeconds`
 * expiry, and returns it. `compute()` always runs on a cache miss OR when
 * Redis is unavailable/unconfigured/erroring — this never blocks a request
 * on the cache being healthy.
 */
export async function cached<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  const redis = getRedis();
  if (!redis) return compute();

  try {
    const hit = await redis.get<T>(key);
    if (hit !== null && hit !== undefined) return hit;
  } catch {
    // Redis read failed — fall through to computing fresh rather than
    // failing the request over a cache problem.
  }

  const value = await compute();

  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch {
    // Cache write failing shouldn't fail a request that already succeeded
    // at the real work — the next request just won't get a cache hit.
  }

  return value;
}
