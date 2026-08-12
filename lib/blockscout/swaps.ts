// Definitive swap detection for a set of transactions. Unlike
// wallet-pnl.ts's existing heuristic (pairing legs against an
// auto-detected "quote" token from the wallet's own history, which can
// miss a real swap when neither side happens to look like a reference
// asset for THIS wallet specifically), checking a transaction's logs for
// one of these events is a hard signal — the swap either really happened
// on-chain or it didn't.
//
// Both addresses below were found and verified live against Robinhood
// Chain's real Uniswap v4 deployment, not guessed or assumed from
// documentation:
// - Searched Blockscout for contracts tagged "PoolManager" — it returned
//   more than one; picked the one with real activity (10,535 transactions,
//   53.9M token transfers) over another sharing the tag with zero
//   transactions.
// - Pulled one of its real, live Swap logs, found the transaction also
//   contained a SECOND Swap-shaped event from a different contract, and
//   confirmed that one's payer/receiver params were both the actual EOA
//   that submitted the transaction (PoolManager's own `sender` param is
//   typically the calling router, not the end user).
import { blockscoutGet, type BlockscoutPage } from "./client";

const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const SWAP_ROUTER = "0xe492912f37c2a4eca45d42dc67548f4c6cd7ce2b";

interface BlockscoutLogParam {
  name: string;
  type: string;
  value: string;
}

interface BlockscoutLogItem {
  address: { hash: string };
  decoded: { method_call: string; parameters: BlockscoutLogParam[] } | null;
}

export interface SwapInfo {
  payer?: string;
  receiver?: string;
  amountIn?: bigint;
  amountOut?: bigint;
  // true when only PoolManager's own Swap event was found (no router-level
  // event in this tx) — still a real, confirmed swap, just without
  // wallet-level attribution or amounts from the more useful event.
  confirmedOnly: boolean;
}

function paramValue(params: BlockscoutLogParam[], name: string): string | undefined {
  return params.find((p) => p.name === name)?.value;
}

function paramBigInt(params: BlockscoutLogParam[], name: string): bigint | undefined {
  const v = paramValue(params, name);
  if (v == null) return undefined;
  try {
    return BigInt(v);
  } catch {
    return undefined;
  }
}

async function fetchTxSwap(txHash: string): Promise<SwapInfo | null> {
  let logs: BlockscoutLogItem[];
  try {
    const page = await blockscoutGet<BlockscoutPage<BlockscoutLogItem>>(`/transactions/${txHash}/logs`);
    logs = page.items;
  } catch {
    // A failed lookup is "unknown," not "confirmed not a swap" — the
    // caller must not treat this the same as a real negative result.
    return null;
  }

  const routerLog = logs.find(
    (l) => l.address.hash.toLowerCase() === SWAP_ROUTER && l.decoded?.method_call.startsWith("Swap("),
  );
  if (routerLog?.decoded) {
    const params = routerLog.decoded.parameters;
    return {
      payer: paramValue(params, "payer")?.toLowerCase(),
      receiver: paramValue(params, "receiver")?.toLowerCase(),
      amountIn: paramBigInt(params, "amountIn"),
      amountOut: paramBigInt(params, "amountOut"),
      confirmedOnly: false,
    };
  }

  const hasPoolManagerSwap = logs.some(
    (l) => l.address.hash.toLowerCase() === POOL_MANAGER && l.decoded?.method_call.startsWith("Swap("),
  );
  if (hasPoolManagerSwap) return { confirmedOnly: true };

  return null;
}

// Small concurrency + pacing — same "don't hammer a shared API with a
// burst" reasoning as fetchWalletTransferLogs' own batching elsewhere in
// this codebase. Applied here because this is one call per DISTINCT
// transaction, not per transfer — a wallet with dozens of transfers can
// still mean dozens of these.
const CONCURRENCY = 4;
const BATCH_DELAY_MS = 150;

export async function detectSwaps(txHashes: string[]): Promise<Map<string, SwapInfo>> {
  const unique = Array.from(new Set(txHashes));
  const result = new Map<string, SwapInfo>();

  for (let i = 0; i < unique.length; i += CONCURRENCY) {
    if (i > 0) await new Promise((r) => setTimeout(r, BATCH_DELAY_MS));
    const batch = unique.slice(i, i + CONCURRENCY);
    const infos = await Promise.all(batch.map(fetchTxSwap));
    batch.forEach((hash, idx) => {
      const info = infos[idx];
      if (info) result.set(hash, info);
    });
  }

  return result;
}
