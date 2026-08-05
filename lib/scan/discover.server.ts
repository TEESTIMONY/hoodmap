// Discovers "trending" tokens on Robinhood Chain from real on-chain activity.
// There's no indexer for this chain, so this scans recent Transfer events
// across ALL contracts (not just one address, unlike the single-token Scan
// pipeline) and ranks by how many distinct wallets touched each token in the
// window — the same signal a real trending list uses, just computed
// directly from logs instead of a database. Server-only.

import { formatUnits, getAddress, parseAbiItem, type Address, type Log } from "viem";
import { getLatestBlockNumber, publicClient, readTokenMetadata, WETH_ADDRESS } from "./rpc.server";

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

// Kept small: an unfiltered eth_getLogs across every contract on the chain
// returns far more data per block than a single-token query, so the window
// and chunk size are both much tighter than the single-token analyzer's.
const DISCOVERY_WINDOW_BLOCKS = 800n;
const DISCOVERY_CHUNK = 50n;
const METADATA_CONCURRENCY = 3;
// Firing all ~16 getLogs chunks at once occasionally gets throttled by the
// public RPC node (whole batch silently degrades to empty via the per-chunk
// catch below). Capping concurrency here makes that far less likely.
const LOG_FETCH_CONCURRENCY = 4;

// Infrastructure tokens that dominate raw transfer counts (wrapped native,
// stablecoins) but aren't "trending" in any meaningful sense — they're the
// quote side of nearly every swap. Excluded from the ranking.
const EXCLUDED_TOKENS = new Set<string>([WETH_ADDRESS]);

export interface TrendingToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: number;
  transferCount: number;
  uniqueTraders: number;
}

export async function discoverTrendingTokens(limit = 20): Promise<TrendingToken[]> {
  const latest = await getLatestBlockNumber();
  const fromBlock = latest > DISCOVERY_WINDOW_BLOCKS ? latest - DISCOVERY_WINDOW_BLOCKS : 0n;

  const chunkStarts: bigint[] = [];
  for (let start = fromBlock; start <= latest; start += DISCOVERY_CHUNK) {
    chunkStarts.push(start);
  }

  let failedChunks = 0;
  const chunkResults: Log[][] = [];
  for (let i = 0; i < chunkStarts.length; i += LOG_FETCH_CONCURRENCY) {
    const batch = chunkStarts.slice(i, i + LOG_FETCH_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (start) => {
        const end = start + DISCOVERY_CHUNK - 1n > latest ? latest : start + DISCOVERY_CHUNK - 1n;
        try {
          return await publicClient.getLogs({ event: TRANSFER_EVENT, fromBlock: start, toBlock: end });
        } catch {
          failedChunks++;
          return [] as Log[];
        }
      }),
    );
    chunkResults.push(...results);
  }

  // A handful of chunk failures is normal RPC flakiness; if most of the
  // window failed to load, the empty result below would be misleading (it
  // would read as "no activity" instead of "couldn't reach the chain").
  if (chunkStarts.length > 0 && failedChunks / chunkStarts.length > 0.5) {
    throw new Error("Robinhood Chain RPC is temporarily unavailable — couldn't scan recent blocks.");
  }

  const transferCount = new Map<string, number>();
  const traders = new Map<string, Set<string>>();

  for (const logs of chunkResults) {
    for (const l of logs as (Log & { args?: { from: Address; to: Address } })[]) {
      if (!l.args) continue;
      const contract = l.address.toLowerCase();
      if (EXCLUDED_TOKENS.has(contract)) continue;
      transferCount.set(contract, (transferCount.get(contract) ?? 0) + 1);
      const set = traders.get(contract) ?? new Set<string>();
      set.add(l.args.from.toLowerCase());
      set.add(l.args.to.toLowerCase());
      traders.set(contract, set);
    }
  }

  const ranked = Array.from(traders.entries())
    .map(([addr, set]) => ({
      addr,
      uniqueTraders: set.size,
      transferCount: transferCount.get(addr) ?? 0,
    }))
    .sort((a, b) => b.uniqueTraders - a.uniqueTraders || b.transferCount - a.transferCount)
    .slice(0, limit);

  const out: TrendingToken[] = [];
  for (let i = 0; i < ranked.length; i += METADATA_CONCURRENCY) {
    const slice = ranked.slice(i, i + METADATA_CONCURRENCY);
    const metas = await Promise.all(
      slice.map((r) =>
        readTokenMetadata(getAddress(r.addr)).catch(() => null),
      ),
    );
    slice.forEach((r, idx) => {
      const meta = metas[idx];
      if (!meta) return;
      out.push({
        address: meta.address,
        name: meta.name,
        symbol: meta.symbol,
        decimals: meta.decimals,
        totalSupply: Number(formatUnits(meta.totalSupplyRaw, meta.decimals)),
        transferCount: r.transferCount,
        uniqueTraders: r.uniqueTraders,
      });
    });
  }

  return out;
}
