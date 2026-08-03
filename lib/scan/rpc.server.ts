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

export async function getLatestBlockNumber(): Promise<bigint> {
  return publicClient.getBlockNumber();
}

// RPC limit: ~1000 blocks per eth_getLogs call. Chunk requests.
const CHUNK = 900n;

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
  const out: RawTransfer[] = [];
  let start = fromBlock;
  while (start <= toBlock) {
    const end = start + CHUNK - 1n > toBlock ? toBlock : start + CHUNK - 1n;
    let logs: Log[] = [];
    try {
      logs = await publicClient.getLogs({
        address,
        event: TRANSFER_EVENT,
        fromBlock: start,
        toBlock: end,
      });
    } catch {
      // If a chunk fails (rare), try halved range once
      const mid = start + (end - start) / 2n;
      try {
        const a = await publicClient.getLogs({
          address,
          event: TRANSFER_EVENT,
          fromBlock: start,
          toBlock: mid,
        });
        const b = await publicClient.getLogs({
          address,
          event: TRANSFER_EVENT,
          fromBlock: mid + 1n,
          toBlock: end,
        });
        logs = [...a, ...b];
      } catch {
        logs = [];
      }
    }
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
      if (out.length >= maxLogs) return out;
    }
    start = end + 1n;
  }
  return out;
}

export async function batchBalanceOf(
  token: string,
  holders: string[],
): Promise<Map<string, bigint>> {
  const address = getAddress(token);
  const results = new Map<string, bigint>();
  // Parallel readContract calls; viem batches JSON-RPC via http({batch:true}).
  const CONCURRENCY = 30;
  for (let i = 0; i < holders.length; i += CONCURRENCY) {
    const slice = holders.slice(i, i + CONCURRENCY);
    const balances = await Promise.all(
      slice.map((h) =>
        publicClient
          .readContract({
            address,
            abi: ERC20_ABI,
            functionName: "balanceOf",
            args: [getAddress(h)],
          })
          .catch(() => 0n),
      ),
    );
    slice.forEach((h, idx) => results.set(h.toLowerCase(), balances[idx] as bigint));
  }
  return results;
}

export async function batchNativeBalance(addresses: string[]): Promise<Map<string, bigint>> {
  const out = new Map<string, bigint>();
  const CONCURRENCY = 30;
  for (let i = 0; i < addresses.length; i += CONCURRENCY) {
    const slice = addresses.slice(i, i + CONCURRENCY);
    const balances = await Promise.all(
      slice.map((a) => publicClient.getBalance({ address: getAddress(a) }).catch(() => 0n)),
    );
    slice.forEach((a, idx) => out.set(a.toLowerCase(), balances[idx] as bigint));
  }
  return out;
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
