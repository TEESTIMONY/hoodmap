// Client-side adapter, ported from HoodMap.
// Calls the Server Action (real Robinhood Chain RPC) and enriches
// price/liquidity/24h stats with DexScreener when available.

import { getAddress } from "viem";
import { analyzeTokenServer } from "./actions";
import { fetchDexScreenerToken } from "./dexscreener";
import type { AnalysisResult } from "./types";

export type ProgressStep = "validating" | "onchain" | "market" | "rendering" | "done";

export interface ProgressUpdate {
  step: ProgressStep;
  label: string;
}

export async function analyzeToken(
  address: string,
  onProgress?: (u: ProgressUpdate) => void,
): Promise<AnalysisResult> {
  onProgress?.({ step: "validating", label: "Validating contract address" });
  let clean: `0x${string}`;
  try {
    // getAddress normalizes all-lowercase input and rejects an invalid mixed-case checksum.
    clean = getAddress(address.trim());
  } catch {
    throw new Error("That doesn't look like a valid Robinhood Chain contract address.");
  }

  // Kick off both in parallel — the server action does the heavy on-chain
  // work, DexScreener enriches market data. Neither blocks the other.
  onProgress?.({
    step: "onchain",
    label: "Reading Robinhood Chain: metadata, transfers, holders, clusters",
  });
  const chainPromise = analyzeTokenServer(clean);

  onProgress?.({ step: "market", label: "Fetching market data from DexScreener" });
  const dexPromise = fetchDexScreenerToken(clean).catch(() => null);

  const [base, dex] = await Promise.all([chainPromise, dexPromise]);

  onProgress?.({ step: "rendering", label: "Rendering intelligence dashboard" });

  if (!dex) {
    onProgress?.({ step: "done", label: "Complete" });
    return {
      ...base,
      dataSources: {
        ...base.dataSources,
        price: "unavailable",
        notes: [
          ...(base.dataSources.notes ?? []),
          "No market data on DexScreener for this contract yet.",
        ],
      },
    };
  }

  const merged: AnalysisResult = {
    ...base,
    token: {
      ...base.token,
      priceUsd: dex.priceUsd ?? base.token.priceUsd,
      marketCapUsd: dex.marketCapUsd ?? base.token.marketCapUsd,
      liquidityUsd: dex.liquidityUsd ?? base.token.liquidityUsd,
      createdAgoSeconds: dex.createdAgoSeconds ?? base.token.createdAgoSeconds,
      dexUrl: dex.dexUrl,
      priceChange24h: dex.priceChange.h24,
      volume24hUsd: dex.volumeUsd.h24,
      txns24h: dex.txns.h24,
    },
    liquidity: {
      ...base.liquidity,
      totalUsd: dex.liquidityUsd ?? base.liquidity.totalUsd,
      pool: dex.poolLabel ?? base.liquidity.pool,
      pairAddress: dex.pairAddress ?? base.liquidity.pairAddress,
    },
    dataSources: {
      ...base.dataSources,
      price: "live",
      liquidity: "live",
      provider: `${base.dataSources.provider ?? "Robinhood Chain RPC"} + DexScreener`,
      lastUpdated: new Date().toISOString(),
    },
  };
  onProgress?.({ step: "done", label: "Complete" });
  return merged;
}

// ─── formatting helpers ─────────────────────────────────────────────────────
const SUBSCRIPT_DIGITS = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];
function toSubscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUBSCRIPT_DIGITS[Number(d)])
    .join("");
}

export function shortNumber(n: number): string {
  if (!isFinite(n)) return "—";
  if (n >= 1e12) return (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  if (n > 0 && n < 0.0001) {
    // e.g. 0.0000293 -> "0.0₄2930" (4 leading zeros, then significant digits)
    const fraction = n.toFixed(20).split(".")[1] ?? "";
    let zeros = 0;
    while (fraction[zeros] === "0") zeros++;
    const digits = fraction.slice(zeros, zeros + 4).replace(/0+$/, "") || "0";
    return `0.0${toSubscript(zeros)}${digits}`;
  }
  return n.toFixed(n < 1 ? 4 : 0);
}
