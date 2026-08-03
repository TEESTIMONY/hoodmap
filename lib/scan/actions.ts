"use server";

// Server Action wrapper for the live Robinhood Chain analyzer — the Next.js
// equivalent of HoodMap's TanStack `createServerFn`. Client components can
// call `analyzeTokenServer(address)` directly; Next.js handles the RPC.

import { analyzeTokenLive } from "./analyze.server";
import { discoverTrendingTokens, type TrendingToken } from "./discover.server";
import { enforceScanRateLimit, enforceTrendingRateLimit } from "./rate-limit.server";
import type { AnalysisResult } from "./types";

function isPlausibleAddress(a: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(a.trim());
}

export async function analyzeTokenServer(address: string): Promise<AnalysisResult> {
  if (!isPlausibleAddress(address)) {
    throw new Error("That doesn't look like a valid Robinhood Chain contract address.");
  }
  await enforceScanRateLimit();
  return analyzeTokenLive(address.trim());
}

export async function discoverTrendingTokensServer(limit = 20): Promise<TrendingToken[]> {
  await enforceTrendingRateLimit();
  return discoverTrendingTokens(limit);
}
