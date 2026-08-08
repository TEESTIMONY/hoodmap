// Drop-in-compatible replacement for rpc.server.ts's readTokenMetadata —
// same output shape (TokenMetaOnChain) plus a `source` tag.
//
// Metadata (name/symbol/decimals) never changes post-deploy; totalSupply
// changes only on mint/burn, rare enough that a cached value stays
// meaningfully accurate between snapshot cycles — unlike balances, there's
// no "which specific number could be silently wrong" risk here worth a
// partial-hybrid merge, so a cached row is used as-is (no per-request
// freshness check — the background job's own cadence is what keeps it
// current, same as everywhere else in this indexer).
//
// Behavior: cached row if one exists; otherwise a live read, written
// through to the cache for next time. DATABASE_URL unset or a DB error
// degrades to the exact previous behavior (100% live), same pattern as
// every other hybrid module here.
import { formatUnits } from "viem";
import { readTokenMetadata, type TokenMetaOnChain } from "@/lib/scan/rpc.server";
import { getCachedTokenMetadata, upsertTokenMetadata } from "./queries";
import { db as getDb } from "./db";

export interface HybridMetadataResult {
  meta: TokenMetaOnChain;
  source: "db" | "rpc";
}

export async function resolveMetadataHybrid(tokenAddress: string): Promise<HybridMetadataResult> {
  if (process.env.DATABASE_URL) {
    try {
      const cached = await getCachedTokenMetadata(getDb(), tokenAddress);
      if (
        cached &&
        cached.name != null &&
        cached.symbol != null &&
        cached.decimals != null &&
        cached.totalSupplyRaw != null
      ) {
        const totalSupplyRaw = BigInt(cached.totalSupplyRaw);
        return {
          source: "db",
          meta: {
            // getAddress(tokenAddress) would also work, but the caller
            // already normalized this — cheaper to just echo it back in
            // the exact checksummed form the caller passed in.
            address: tokenAddress as TokenMetaOnChain["address"],
            name: cached.name,
            symbol: cached.symbol,
            decimals: cached.decimals,
            totalSupplyRaw,
            totalSupply: Number(formatUnits(totalSupplyRaw, cached.decimals)),
          },
        };
      }
    } catch {
      // DB unreachable/misconfigured — fall through to the live path below
      // exactly as if DATABASE_URL had never been set.
    }
  }

  const meta = await readTokenMetadata(tokenAddress);
  if (process.env.DATABASE_URL) {
    // Best-effort write-through — a failure here must never fail the scan
    // that's already succeeded live.
    upsertTokenMetadata(getDb(), tokenAddress, meta).catch(() => {});
  }
  return { meta, source: "rpc" };
}
