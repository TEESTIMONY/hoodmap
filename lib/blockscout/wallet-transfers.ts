// Blockscout-backed wallet transfer history — paginated (cursor-based), so
// a hyperactive CONTRACT doesn't blow through the live RPC scanner's
// request-volume limits the way it did before this existed. Confirmed
// live: scanning Uniswap v4's own PoolManager singleton (which every swap
// on the chain touches, since v4 holds every pool's balance directly in
// one contract) failed all 120 of 120 raw eth_getLogs fetches under the
// old tiered live-RPC scanner. Cursor pagination costs the same per page
// regardless of how deep it goes, unlike an unbounded topic-filtered log
// sweep that has to actually enumerate a huge result set per RPC call.
import { getAddress, type Address } from "viem";
import { blockscoutGet, type BlockscoutPage } from "./client";
import type { RawWalletTransfer } from "@/lib/scan/rpc.server";

interface BlockscoutAddressRef {
  hash: string;
}

interface BlockscoutTokenTransferItem {
  block_number: number;
  from: BlockscoutAddressRef;
  to: BlockscoutAddressRef;
  log_index: number;
  token: { address_hash: string; decimals: string | null; symbol: string | null };
  total: { value: string } | null;
  transaction_hash: string;
}

export interface BlockscoutTokenMeta {
  symbol: string;
  decimals: number;
}

// Bounds worst-case cost/time — 50 items/page, 20 credits/page (confirmed
// live), so 40 pages is 2,000 transfers for 800 credits: generous for a
// genuinely active wallet, small against the free tier's 100,000/day
// budget, and enough headroom that a hyperactive CONTRACT (not really a
// "wallet") degrades to "partial, real data" rather than either hanging
// or draining a large fraction of one day's credits in a single scan.
const MAX_PAGES = 40;

export interface BlockscoutWalletTransfersResult {
  transfers: RawWalletTransfer[];
  truncated: boolean;
  // Token symbol/decimals, straight off the same response that already
  // returned each transfer — costs nothing extra to collect. Confirmed
  // live this matters, not just in theory: scanning Uniswap v4's
  // PoolManager (which touches nearly every token that's ever traded on
  // the chain) took 5+ minutes end to end specifically because the
  // downstream live-RPC decimals/symbol lookup couldn't keep up with that
  // many distinct tokens (1,819 of 2,133 transfers failed that lookup
  // alone). Pre-seeding from what Blockscout already gave us for free
  // means the caller only needs live RPC for tokens actually missing from
  // this map — normally none, when every transfer came from Blockscout.
  tokenMetadata: Map<string, BlockscoutTokenMeta>;
}

export async function fetchWalletTransfersBlockscout(
  wallet: string,
): Promise<BlockscoutWalletTransfersResult> {
  const address = getAddress(wallet);
  const transfers: RawWalletTransfer[] = [];
  const tokenMetadata = new Map<string, BlockscoutTokenMeta>();
  let pageParams: Record<string, string | number | boolean | undefined> | undefined = {
    type: "ERC-20",
  };
  let truncated = false;

  for (let i = 0; i < MAX_PAGES; i++) {
    // Paces sequential pages under the free tier's 5 requests/second cap —
    // blockscoutGet already retries a 429 with backoff, but avoiding one in
    // the first place is cheaper than recovering from it, especially for a
    // fetch that can run 40 pages deep.
    if (i > 0) await new Promise((r) => setTimeout(r, 300));
    const page: BlockscoutPage<BlockscoutTokenTransferItem> = await blockscoutGet(
      `/addresses/${address}/token-transfers`,
      pageParams,
    );
    for (const item of page.items) {
      if (!item.total?.value) continue; // no fungible amount (shouldn't occur with type=ERC-20, kept defensive)
      try {
        const token = getAddress(item.token.address_hash) as Address;
        transfers.push({
          token,
          from: getAddress(item.from.hash) as Address,
          to: getAddress(item.to.hash) as Address,
          valueRaw: BigInt(item.total.value),
          blockNumber: BigInt(item.block_number),
          txHash: item.transaction_hash as `0x${string}`,
          logIndex: item.log_index,
        });
        // decimals/symbol don't vary by transfer — only worth recording
        // once, and only when both are actually present (a token missing
        // either here just falls through to the caller's own live-RPC
        // resolution, same as before this existed).
        const tokenLower = token.toLowerCase();
        if (!tokenMetadata.has(tokenLower) && item.token.decimals != null && item.token.symbol) {
          tokenMetadata.set(tokenLower, { symbol: item.token.symbol, decimals: Number(item.token.decimals) });
        }
      } catch {
        // A single malformed item (unexpected address casing, non-numeric
        // value, etc.) shouldn't drop the whole page — skip just this one.
      }
    }
    if (!page.next_page_params) break;
    if (i === MAX_PAGES - 1) truncated = true;
    pageParams = { type: "ERC-20", ...page.next_page_params };
  }

  return { transfers, truncated, tokenMetadata };
}
