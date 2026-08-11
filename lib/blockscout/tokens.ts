// Typed wrappers around the Blockscout Pro API's /tokens endpoints.
// Field types match the real, live-confirmed response shape (numbers come
// back as strings, per Blockscout's convention of avoiding JS float
// precision loss on large uint256-range values) — not the OpenAPI spec,
// which wasn't reachable when this was built; verified against real
// requests instead.
import { blockscoutGet, type BlockscoutPage } from "./client";

export interface BlockscoutTokenListItem {
  address_hash: string;
  name: string | null;
  symbol: string | null;
  decimals: string | null;
  total_supply: string | null;
  holders_count: string | null;
  exchange_rate: string | null;
  circulating_market_cap: string | null;
  volume_24h: string | null;
  icon_url: string | null;
  type: string;
}

export function fetchTokensPage(
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<BlockscoutPage<BlockscoutTokenListItem>> {
  return blockscoutGet<BlockscoutPage<BlockscoutTokenListItem>>("/tokens", params);
}
