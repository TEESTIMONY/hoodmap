// Discovers "trending" tokens on Robinhood Chain from real on-chain activity.
// There's no indexer for this chain, so this scans recent Transfer events
// across ALL contracts (not just one address, unlike the single-token Scan
// pipeline) and ranks by how many distinct wallets touched each token in the
// window — the same signal a real trending list uses, just computed
// directly from logs instead of a database. Server-only.

import { formatUnits, getAddress, parseAbiItem, type Address, type Log } from "viem";
import {
  getLatestBlockNumber,
  isNftContract,
  publicClient,
  readTokenMetadata,
  WETH_ADDRESS,
} from "./rpc.server";

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

// "Top tokens" is meant to surface memecoins specifically. Sampling real
// trending tokens on this chain showed it's overwhelmingly memecoins
// (DERP, WOOF/Shibinhood, CASHCAT, monkey coin, NASDANQ, ...) plus a few
// confirmed non-meme categories, each with a reliable pattern:
//   - Tokenized real-world stocks: name always carries this exact suffix,
//     e.g. "NVIDIA • Robinhood Token", "GameStop • Robinhood Token".
//   - Stablecoins: e.g. "Global Dollar" (USDG), USDC/USDT/DAI-style names.
//   - Uniswap's own LP-position NFT tokens, e.g. "UNI-V4-POSM" / "Uniswap
//     v4 Positions NFT" — not a tradeable token at all.
//   - NFT collections: a log-based scan can't tell an ERC-721/1155
//     collection apart from a real token by its Transfer logs alone (same
//     event signature) — confirmed in practice when "H00dle NFT" showed up
//     in raw discovery results. Name-keyword catches the self-describing
//     cases cheaply; isNftContract() (ERC-165) below catches the rest.
// Everything else is treated as a memecoin rather than trying to build a
// positive allowlist, since that's what the actual data looks like here.
function isNonMemeByNameOrSymbol(name: string, symbol: string): boolean {
  const n = name.toLowerCase();
  const s = symbol.toLowerCase();
  if (n.includes("robinhood token")) return true;
  if (
    n.includes("dollar") ||
    n.includes("stablecoin") ||
    n.includes("stable coin") ||
    s.includes("usd") ||
    s === "dai" ||
    s === "tether"
  ) {
    return true;
  }
  if (s.startsWith("uni-") || (n.includes("uniswap") && n.includes("position"))) return true;
  if (n.includes("nft") || s.includes("nft")) return true;
  return false;
}

// Resolving metadata for exactly `limit` candidates would under-fill the
// list once non-meme tokens get filtered out afterward — this fetches a
// bigger candidate pool up front so the final memecoin-only list still
// comes close to the requested size.
const CANDIDATE_BUFFER_RATIO = 0.6;

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

  const candidateLimit = Math.ceil(limit * (1 + CANDIDATE_BUFFER_RATIO));
  const ranked = Array.from(traders.entries())
    .map(([addr, set]) => ({
      addr,
      uniqueTraders: set.size,
      transferCount: transferCount.get(addr) ?? 0,
    }))
    .sort((a, b) => b.uniqueTraders - a.uniqueTraders || b.transferCount - a.transferCount)
    .slice(0, candidateLimit);

  const out: TrendingToken[] = [];
  for (let i = 0; i < ranked.length && out.length < limit; i += METADATA_CONCURRENCY) {
    const slice = ranked.slice(i, i + METADATA_CONCURRENCY);
    // Metadata and the ERC-165 NFT check run in parallel per candidate —
    // the NFT check doesn't depend on metadata, so there's no reason to
    // wait on one before starting the other.
    const [metas, nftFlags] = await Promise.all([
      Promise.all(slice.map((r) => readTokenMetadata(getAddress(r.addr)).catch(() => null))),
      Promise.all(slice.map((r) => isNftContract(r.addr).catch(() => false))),
    ]);
    slice.forEach((r, idx) => {
      const meta = metas[idx];
      if (!meta) return;
      if (nftFlags[idx]) return;
      if (isNonMemeByNameOrSymbol(meta.name, meta.symbol)) return;
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

  return out.slice(0, limit);
}
