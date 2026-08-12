// Native ETH legs for a wallet — combines the wallet's own top-level
// transaction `value` (ETH sent as part of a transaction the wallet itself
// submitted, e.g. buying a token by sending ETH straight to a router) with
// its internal-transaction history (ETH received or sent DURING a
// contract call, e.g. a router sending sale proceeds back to the wallet).
//
// Why this exists: confirmed live, on a real wallet, that a token-for-ETH
// swap is otherwise completely invisible to trade detection. The wallet's
// ERC-20 Transfer events showed it sending a token out with NO matching
// inbound leg — the proceeds came back as a plain internal ETH transfer,
// which never emits a Transfer event at all. Without this, that
// transaction can never even become a "1 out + 1 in" candidate in
// wallet-pnl.ts, regardless of how the quote-asset heuristic is tuned —
// the other leg simply isn't in the data.
import { getAddress } from "viem";
import { blockscoutGet, type BlockscoutPage } from "./client";

// Sentinel token address for native ETH — never collides with a real
// contract address (those are always 20 bytes of hex), used the same way
// this codebase already treats WETH as a seedable quote asset.
export const NATIVE_ETH_ADDRESS = "native-eth";

export interface NativeLeg {
  direction: "in" | "out";
  amountWei: bigint;
  timestamp: number;
  blockNumber: bigint;
  txHash: string;
}

interface TxItem {
  hash: string;
  from: { hash: string } | null;
  to: { hash: string } | null;
  value: string;
  block_number: number;
  timestamp: string;
}

interface InternalTxItem {
  transaction_hash: string;
  from: { hash: string } | null;
  to: { hash: string } | null;
  value: string;
  block_number: number;
  timestamp: string;
}

// Bounds cost/time — this runs alongside the wallet's own transfer fetch
// and swap detection in the same scan, on TWO separate paginated
// endpoints, so it needs a real ceiling, not just "generous." Confirmed
// live: at 20 pages/endpoint, a wallet scan that also had to retry through
// rate-limit pressure elsewhere took 39+ minutes end to end — this is
// explicitly a supplementary enrichment (fixing a real blind spot for the
// most RECENT native-ETH activity), not the primary data source, so a
// smaller, real ceiling is the right tradeoff over trying to be complete.
const MAX_PAGES = 5;

async function paginate<T>(
  path: string,
  onPage: (items: T[]) => void,
): Promise<boolean> {
  let pageParams: Record<string, string | number | boolean | null | undefined> | undefined;
  let truncated = false;
  for (let i = 0; i < MAX_PAGES; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 300));
    const page: BlockscoutPage<T> = await blockscoutGet(path, pageParams);
    onPage(page.items);
    if (!page.next_page_params) return truncated;
    if (i === MAX_PAGES - 1) truncated = true;
    pageParams = page.next_page_params;
  }
  return truncated;
}

function toUnixSeconds(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

export interface NativeTransfersResult {
  legs: NativeLeg[];
  truncated: boolean;
}

export async function fetchNativeTransfers(wallet: string): Promise<NativeTransfersResult> {
  const address = getAddress(wallet);
  const addrLower = address.toLowerCase();
  const legs: NativeLeg[] = [];
  let truncated = false;

  const t1 = await paginate<TxItem>(`/addresses/${address}/transactions`, (items) => {
    for (const tx of items) {
      let value: bigint;
      try {
        value = BigInt(tx.value ?? "0");
      } catch {
        continue;
      }
      if (value === 0n) continue;
      const from = tx.from?.hash?.toLowerCase();
      const to = tx.to?.hash?.toLowerCase();
      if (from !== addrLower && to !== addrLower) continue;
      legs.push({
        direction: from === addrLower ? "out" : "in",
        amountWei: value,
        timestamp: toUnixSeconds(tx.timestamp),
        blockNumber: BigInt(tx.block_number),
        txHash: tx.hash,
      });
    }
  });
  truncated ||= t1;

  const t2 = await paginate<InternalTxItem>(`/addresses/${address}/internal-transactions`, (items) => {
    for (const itx of items) {
      let value: bigint;
      try {
        value = BigInt(itx.value ?? "0");
      } catch {
        continue;
      }
      if (value === 0n) continue;
      const from = itx.from?.hash?.toLowerCase();
      const to = itx.to?.hash?.toLowerCase();
      if (from !== addrLower && to !== addrLower) continue;
      legs.push({
        direction: from === addrLower ? "out" : "in",
        amountWei: value,
        timestamp: toUnixSeconds(itx.timestamp),
        blockNumber: BigInt(itx.block_number),
        txHash: itx.transaction_hash,
      });
    }
  });
  truncated ||= t2;

  return { legs, truncated };
}
