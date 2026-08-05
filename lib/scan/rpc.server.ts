// Robinhood Chain RPC adapter, ported from HoodMap.
// Server-only — do not import directly from client code.
// Uses viem for typed ERC-20 calls and public client access.

import {
  createPublicClient,
  http,
  parseAbi,
  parseAbiItem,
  formatUnits,
  getAddress,
  type Address,
  type Log,
} from "viem";

export const RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const CHAIN_ID = 4663;

// Custom viem chain definition — Robinhood Chain isn't in viem/chains yet.
const robinhoodChain = {
  id: CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const;

export const publicClient = createPublicClient({
  chain: robinhoodChain,
  transport: http(RPC_URL, { batch: true, retryCount: 1, timeout: 15_000 }),
});

const ERC20_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

// ERC-721/1155's Transfer/TransferSingle-adjacent events share the exact
// same log signature as ERC-20's Transfer, so a log-based discovery scan
// (this chain has no indexer to ask "is this contract fungible?") can't
// tell an NFT collection apart from a real token just from the logs —
// confirmed in practice when an actual NFT collection ("H00dle NFT") showed
// up in trending-token discovery. ERC-165's supportsInterface is the
// correct, direct way to ask a contract what it actually is, rather than
// guessing from its name.
const ERC165_ABI = parseAbi(["function supportsInterface(bytes4) view returns (bool)"]);
const ERC721_INTERFACE_ID = "0x80ac58cd" as const;
const ERC1155_INTERFACE_ID = "0xd9b67a26" as const;

export async function isNftContract(address: string): Promise<boolean> {
  const token = getAddress(address);
  const [is721, is1155] = await Promise.all([
    publicClient
      .readContract({
        address: token,
        abi: ERC165_ABI,
        functionName: "supportsInterface",
        args: [ERC721_INTERFACE_ID],
      })
      .catch(() => false),
    publicClient
      .readContract({
        address: token,
        abi: ERC165_ABI,
        functionName: "supportsInterface",
        args: [ERC1155_INTERFACE_ID],
      })
      .catch(() => false),
  ]);
  return Boolean(is721) || Boolean(is1155);
}

// Wrapped-native quote token — the "priced against" side of nearly every
// swap on Robinhood Chain. Shared by discovery (excluded from trending
// ranking, since it dominates raw transfer counts) and wallet PnL
// reconstruction (the reference asset trade prices are computed against).
export const WETH_ADDRESS = "0x0bd7d308f8e1639fab988df18a8011f41eacad73" as const;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const DEAD_ADDRESSES = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);

export function isBurnAddress(a: string): boolean {
  return DEAD_ADDRESSES.has(a.toLowerCase());
}

export interface TokenMetaOnChain {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupplyRaw: bigint;
  totalSupply: number;
}

export async function readTokenMetadata(address: string): Promise<TokenMetaOnChain> {
  const token = getAddress(address);
  const [name, symbol, decimals, totalSupplyRaw] = await Promise.all([
    publicClient
      .readContract({ address: token, abi: ERC20_ABI, functionName: "name" })
      .catch(() => "Unknown Token"),
    publicClient
      .readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" })
      .catch(() => "TOKEN"),
    publicClient
      .readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" })
      .catch(() => 18),
    publicClient
      .readContract({ address: token, abi: ERC20_ABI, functionName: "totalSupply" })
      .catch(() => 0n),
  ]);
  const dec = Number(decimals);
  return {
    address: token,
    name: String(name),
    symbol: String(symbol),
    decimals: dec,
    totalSupplyRaw,
    totalSupply: Number(formatUnits(totalSupplyRaw, dec)),
  };
}

// Unlike readTokenMetadata (which swallows each field's RPC failure
// independently, defaulting decimals to 18 — fine for display purposes),
// this throws if either call fails. The wallet PnL engine divides by
// decimals to compute every trade's price; a wrong assumed value there
// doesn't fail visibly, it silently produces a plausible-looking but
// incorrect number, which is worse than no number at all.
export async function readTokenDecimalsAndSymbolStrict(
  address: string,
): Promise<{ symbol: string; decimals: number }> {
  const token = getAddress(address);
  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }),
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }),
  ]);
  return { symbol: String(symbol), decimals: Number(decimals) };
}

// Same reasoning as readTokenDecimalsAndSymbolStrict above, but for callers
// that also need `name` — specifically token discovery's memecoin filter,
// which keys heavily off name text (e.g. the "• Robinhood Token" suffix,
// "dollar"). readTokenMetadata's lenient per-field fallback means a metadata
// hiccup silently becomes generic "Unknown Token"/"TOKEN" placeholder text
// that still passes through as if it were real data — which can't match
// any exclusion pattern, so a stablecoin or tokenized stock whose metadata
// call happened to fail would slip straight through the memecoin filter
// instead of being excluded. Confirmed happening on live traffic: a run
// where most rows resolved to "Unknown Token"/"TOKEN" also let USDG and
// NVDA (an official tokenized-stock token) through. Throwing here instead
// lets the caller exclude the candidate rather than trust fabricated text.
export async function readTokenMetadataStrict(address: string): Promise<TokenMetaOnChain> {
  const token = getAddress(address);
  const [name, symbol, decimals, totalSupplyRaw] = await Promise.all([
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "name" }),
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }),
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }),
    publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: "totalSupply" }),
  ]);
  const dec = Number(decimals);
  return {
    address: token,
    name: String(name),
    symbol: String(symbol),
    decimals: dec,
    totalSupplyRaw,
    totalSupply: Number(formatUnits(totalSupplyRaw, dec)),
  };
}

export async function getLatestBlockNumber(): Promise<bigint> {
  return publicClient.getBlockNumber();
}

// RPC limit: ~1000 blocks per eth_getLogs call. Chunk requests.
const CHUNK = 900n;
// Fetching one chunk at a time was fine at the token scanner's old
// 5,000-block window (a handful of chunks). At the current 500,000-block
// window that's ~550+ round trips — sequential, that's many minutes of
// pure RPC latency. Concurrency here mirrors the same fix already applied
// to the wallet scanner's transfer-log fetcher.
const CHUNK_CONCURRENCY = 6;

export interface RawTransfer {
  from: Address;
  to: Address;
  valueRaw: bigint;
  blockNumber: bigint;
  txHash: `0x${string}`;
  logIndex: number;
}

export async function fetchTransferLogs(
  token: string,
  fromBlock: bigint,
  toBlock: bigint,
  maxLogs = 20_000,
): Promise<RawTransfer[]> {
  const address = getAddress(token);

  async function fetchChunk(start: bigint, end: bigint): Promise<Log[]> {
    try {
      return await publicClient.getLogs({ address, event: TRANSFER_EVENT, fromBlock: start, toBlock: end });
    } catch {
      // If a chunk fails (rare), try halved range once
      const mid = start + (end - start) / 2n;
      try {
        const [a, b] = await Promise.all([
          publicClient.getLogs({ address, event: TRANSFER_EVENT, fromBlock: start, toBlock: mid }),
          publicClient.getLogs({ address, event: TRANSFER_EVENT, fromBlock: mid + 1n, toBlock: end }),
        ]);
        return [...a, ...b];
      } catch {
        return [];
      }
    }
  }

  const chunkStarts: bigint[] = [];
  for (let start = fromBlock; start <= toBlock; start += CHUNK) chunkStarts.push(start);

  const out: RawTransfer[] = [];
  for (let i = 0; i < chunkStarts.length && out.length < maxLogs; i += CHUNK_CONCURRENCY) {
    const batch = chunkStarts.slice(i, i + CHUNK_CONCURRENCY);
    // Chunks within a batch run concurrently, but results are appended in
    // the same ascending-block-order the old sequential loop produced —
    // nothing downstream should observe a difference besides speed.
    const results = await Promise.all(
      batch.map((start) => {
        const end = start + CHUNK - 1n > toBlock ? toBlock : start + CHUNK - 1n;
        return fetchChunk(start, end);
      }),
    );
    outer: for (const logs of results) {
      for (const l of logs as (Log & { args?: { from: Address; to: Address; value: bigint } })[]) {
        if (!l.args) continue;
        out.push({
          from: l.args.from,
          to: l.args.to,
          valueRaw: l.args.value,
          blockNumber: l.blockNumber ?? 0n,
          txHash: l.transactionHash ?? "0x",
          logIndex: l.logIndex ?? 0,
        });
        if (out.length >= maxLogs) break outer;
      }
    }
  }
  return out;
}

export interface RawWalletTransfer extends RawTransfer {
  token: Address;
}

// Unlike fetchTransferLogs (one contract, all holders), this scans ALL
// contracts for Transfer events where the given wallet is sender or
// receiver — there's no indexer for this chain, so "this wallet's full
// history" means two topic-filtered (not address-filtered) eth_getLogs
// sweeps across the requested block range. A single indexed-topic filter is
// far sparser than discover.server.ts's fully unfiltered scan, so it can
// afford much larger chunks.
//
// Measured live: at a 10k chunk / concurrency-6 pace (~1000 requests for a
// 5M-block scan, fired back to back), 68-100% of fetches failed even with a
// retry — two consecutive scans of the same wallet returned 224 transfers,
// then 0. That's the public RPC pushing back on request *volume*, not
// occasional flakiness a retry can paper over. Larger chunks (fewer total
// requests) plus lower concurrency and a pacing delay between batches
// (gentler load) address the actual cause instead of retrying into the
// same wall.
const WALLET_SCAN_CHUNK = 25_000n;
const WALLET_SCAN_CONCURRENCY = 3;
const WALLET_SCAN_BATCH_DELAY_MS = 250;

export interface WalletTransferLogsResult {
  transfers: RawWalletTransfer[];
  truncated: boolean;
  // Chunk/direction fetches that still failed after a retry — logs from
  // that specific block range are missing, not just delayed. Distinct from
  // `truncated` (which means the *maxLogs* cap was hit, not that fetching
  // failed).
  failedFetches: number;
  totalFetches: number;
}

export async function fetchWalletTransferLogs(
  wallet: string,
  fromBlock: bigint,
  toBlock: bigint,
  maxLogs = 20_000,
): Promise<WalletTransferLogsResult> {
  const address = getAddress(wallet);
  const chunkStarts: bigint[] = [];
  for (let start = fromBlock; start <= toBlock; start += WALLET_SCAN_CHUNK) {
    chunkStarts.push(start);
  }

  const out: RawWalletTransfer[] = [];
  let truncated = false;
  let failedFetches = 0;
  let totalFetches = 0;

  async function fetchDirection(start: bigint, end: bigint, direction: "from" | "to") {
    totalFetches++;
    const args = direction === "from" ? { from: address } : { to: address };
    try {
      return await publicClient.getLogs({ event: TRANSFER_EVENT, args, fromBlock: start, toBlock: end });
    } catch {
      // Retry once — this RPC has shown transient per-chunk failures under
      // load; a single retry meaningfully reduces how often a real chunk of
      // history silently comes back empty.
      try {
        return await publicClient.getLogs({ event: TRANSFER_EVENT, args, fromBlock: start, toBlock: end });
      } catch {
        failedFetches++;
        return [] as Log[];
      }
    }
  }

  for (let i = 0; i < chunkStarts.length && !truncated; i += WALLET_SCAN_CONCURRENCY) {
    if (i > 0) await new Promise((r) => setTimeout(r, WALLET_SCAN_BATCH_DELAY_MS));
    const batch = chunkStarts.slice(i, i + WALLET_SCAN_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (start) => {
        const end = start + WALLET_SCAN_CHUNK - 1n > toBlock ? toBlock : start + WALLET_SCAN_CHUNK - 1n;
        const [outgoing, incoming] = await Promise.all([
          fetchDirection(start, end, "from"),
          fetchDirection(start, end, "to"),
        ]);
        return [...outgoing, ...incoming];
      }),
    );
    for (const logs of results) {
      for (const l of logs as (Log & { args?: { from: Address; to: Address; value: bigint } })[]) {
        if (!l.args) continue;
        out.push({
          token: l.address,
          from: l.args.from,
          to: l.args.to,
          valueRaw: l.args.value,
          blockNumber: l.blockNumber ?? 0n,
          txHash: l.transactionHash ?? "0x",
          logIndex: l.logIndex ?? 0,
        });
        if (out.length >= maxLogs) {
          truncated = true;
          break;
        }
      }
      if (truncated) break;
    }
  }
  return { transfers: out, truncated, failedFetches, totalFetches };
}

// Confirmed live (FRONG token, see the "0.00%" investigation): under the
// combined RPC load a full analyzeTokenLive run generates, some balanceOf
// calls in a batch fail even with the transport's own retryCount:1 — and
// the old `.catch(() => 0n)` silently turned that failure into "this wallet
// holds 0 tokens," which is indistinguishable from a real 0 balance and
// corrupts pctSupply/whale rankings for a wallet that may actually be a top
// holder. A standalone call to the same address for the same block
// succeeded immediately after, confirming this is transient throttling, not
// a real zero. Returning `failed` lets the caller exclude those addresses
// from holder rows entirely (same "exclude rather than fabricate" pattern
// used for strict token metadata reads) instead of quietly lying about them.
export async function batchBalanceOf(
  token: string,
  holders: string[],
): Promise<{ balances: Map<string, bigint>; failed: string[] }> {
  const address = getAddress(token);
  const results = new Map<string, bigint>();
  // Parallel readContract calls; viem batches JSON-RPC via http({batch:true}).
  const CONCURRENCY = 30;

  async function fetchPass(list: string[]): Promise<string[]> {
    const stillFailed: string[] = [];
    for (let i = 0; i < list.length; i += CONCURRENCY) {
      const slice = list.slice(i, i + CONCURRENCY);
      const balances = await Promise.all(
        slice.map((h) =>
          publicClient
            .readContract({
              address,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [getAddress(h)],
            })
            .then((v) => v as bigint)
            .catch(() => null),
        ),
      );
      slice.forEach((h, idx) => {
        const b = balances[idx];
        if (b == null) stillFailed.push(h);
        else results.set(h.toLowerCase(), b);
      });
    }
    return stillFailed;
  }

  const firstPassFailed = await fetchPass(holders);
  // Retry as a second full pass (not an immediate same-tick re-call) — the
  // wall-clock time a full pass over up to 100 addresses takes gives real
  // separation from whatever throttling window caused the first failure.
  const stillFailed = firstPassFailed.length ? await fetchPass(firstPassFailed) : [];
  return { balances: results, failed: stillFailed.map((h) => h.toLowerCase()) };
}

// Same failure mode and same fix as batchBalanceOf above: a getBalance call
// that fails under load used to silently become "0 ETH" instead of an
// honest "couldn't fetch." Callers should treat an address missing from the
// returned map as unresolved, not as a confirmed zero balance.
export async function batchNativeBalance(
  addresses: string[],
): Promise<{ balances: Map<string, bigint>; failed: string[] }> {
  const out = new Map<string, bigint>();
  const CONCURRENCY = 30;

  async function fetchPass(list: string[]): Promise<string[]> {
    const stillFailed: string[] = [];
    for (let i = 0; i < list.length; i += CONCURRENCY) {
      const slice = list.slice(i, i + CONCURRENCY);
      const balances = await Promise.all(
        slice.map((a) =>
          publicClient
            .getBalance({ address: getAddress(a) })
            .then((v) => v as bigint)
            .catch(() => null),
        ),
      );
      slice.forEach((a, idx) => {
        const b = balances[idx];
        if (b == null) stillFailed.push(a);
        else out.set(a.toLowerCase(), b);
      });
    }
    return stillFailed;
  }

  const firstPassFailed = await fetchPass(addresses);
  const stillFailed = firstPassFailed.length ? await fetchPass(firstPassFailed) : [];
  return { balances: out, failed: stillFailed.map((a) => a.toLowerCase()) };
}

export async function batchBlockTimestamps(blockNumbers: bigint[]): Promise<Map<string, number>> {
  const uniq = Array.from(new Set(blockNumbers.map((b) => b.toString())));
  const out = new Map<string, number>();
  const CONCURRENCY = 20;
  for (let i = 0; i < uniq.length; i += CONCURRENCY) {
    const slice = uniq.slice(i, i + CONCURRENCY);
    const blocks = await Promise.all(
      slice.map((n) =>
        publicClient
          .getBlock({ blockNumber: BigInt(n), includeTransactions: false })
          .catch(() => null),
      ),
    );
    slice.forEach((n, idx) => {
      const b = blocks[idx];
      if (b) out.set(n, Number(b.timestamp));
    });
  }
  return out;
}

// Try to find contract creation block by binary search over eth_getCode.
// Robinhood Chain doesn't expose an "eth_getContractCreation" method, so this
// is best-effort: we only search back a bounded range.
export async function estimateContractAgeSeconds(
  address: string,
  latestBlock: bigint,
  scanBackBlocks: bigint = 100_000n,
): Promise<number | undefined> {
  const token = getAddress(address);
  const lo0 = latestBlock > scanBackBlocks ? latestBlock - scanBackBlocks : 0n;
  // Check if code existed at lo0
  const codeLo = await publicClient
    .getCode({ address: token, blockNumber: lo0 })
    .catch(() => "0x" as `0x${string}`);
  if (codeLo && codeLo !== "0x") return undefined; // older than window
  let lo = lo0,
    hi = latestBlock;
  for (let i = 0; i < 22 && hi - lo > 1n; i++) {
    const mid = lo + (hi - lo) / 2n;
    const code = await publicClient
      .getCode({ address: token, blockNumber: mid })
      .catch(() => "0x" as `0x${string}`);
    if (code && code !== "0x") hi = mid;
    else lo = mid;
  }
  const [blk] = await Promise.all([publicClient.getBlock({ blockNumber: hi }).catch(() => null)]);
  if (!blk) return undefined;
  return Math.max(0, Math.floor(Date.now() / 1000) - Number(blk.timestamp));
}

export { formatUnits };
