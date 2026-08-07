"use server";

// Server Action wrapper for the live Robinhood Chain analyzer — the Next.js
// equivalent of HoodMap's TanStack `createServerFn`. Client components can
// call `analyzeTokenServer(address)` directly; Next.js handles the RPC.

import { analyzeTokenLive } from "./analyze.server";
import { analyzeWalletLive } from "./wallet-analyze.server";
import { discoverTrendingTokens, type TrendingToken } from "./discover.server";
import { fetchDexScreenerToken, type DexPairData } from "./dexscreener";
import { cached } from "./cache.server";
import {
  enforceScanRateLimit,
  enforceTrendingRateLimit,
  enforceWalletScanRateLimit,
} from "./rate-limit.server";
import type { AnalysisResult } from "./types";
import type { WalletPnlSummary } from "./wallet-types";

function isPlausibleAddress(a: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(a.trim());
}

// Cache TTLs are deliberately short — this is about collapsing duplicate
// concurrent/near-concurrent requests for the same token (the common case:
// several visitors looking at a trending token within the same minute),
// not about serving stale data. A scan result up to 45s old, or DexScreener
// data up to 30s old, is well within the noise of what "live" already means
// for an actively-traded memecoin — every scan already only reflects a
// window as of whenever it ran.
const SCAN_CACHE_TTL_SECONDS = 45;
const TRENDING_CACHE_TTL_SECONDS = 60;
const DEX_CACHE_TTL_SECONDS = 30;

export async function analyzeTokenServer(address: string): Promise<AnalysisResult> {
  if (!isPlausibleAddress(address)) {
    throw new Error("That doesn't look like a valid Robinhood Chain contract address.");
  }
  await enforceScanRateLimit();
  const clean = address.trim();
  return cached(`scan:${clean.toLowerCase()}`, SCAN_CACHE_TTL_SECONDS, () => analyzeTokenLive(clean));
}

export async function discoverTrendingTokensServer(limit = 20): Promise<TrendingToken[]> {
  await enforceTrendingRateLimit();
  return cached(`trending:${limit}`, TRENDING_CACHE_TTL_SECONDS, () => discoverTrendingTokens(limit));
}

// Moved server-side (was called directly from the browser, one request per
// token, in TopTokens.tsx) for two reasons: it's now cacheable and shared
// across every visitor instead of every browser hitting DexScreener
// independently, and it stops exposing that call pattern directly to the
// client. Caching a legitimate `null` result (no DexScreener pair for this
// token) is a known no-op here — cache.server.ts's hit-check treats
// null/undefined as "not cached," so a token with no pair is simply
// refetched every time rather than cached as "definitely no data." That's
// a minor inefficiency, not a correctness issue.
export async function fetchDexScreenerTokenServer(address: string): Promise<DexPairData | null> {
  return cached(`dex:${address.toLowerCase()}`, DEX_CACHE_TTL_SECONDS, () =>
    fetchDexScreenerToken(address),
  );
}

export async function analyzeWalletServer(address: string): Promise<WalletPnlSummary> {
  if (!isPlausibleAddress(address)) {
    throw new Error("That doesn't look like a valid Robinhood Chain wallet address.");
  }
  await enforceWalletScanRateLimit();
  return analyzeWalletLive(address.trim());
}
