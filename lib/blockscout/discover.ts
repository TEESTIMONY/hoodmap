// Blockscout-backed trending discovery — replaces the live 800-block
// (~13-minute) unfiltered chain scan discover.server.ts used to run on
// every request with real, already-computed 24h volume and holder counts
// from Robinhood Chain's official Blockscout instance. See
// discover.server.ts for the live-RPC fallback this sits in front of, and
// for the isNonMemeByNameOrSymbol filter this reuses (kept in one place —
// "what counts as a memecoin for this app" shouldn't drift between the two
// sourcing paths).
import { getAddress, formatUnits } from "viem";
import { fetchTokensPage, type BlockscoutTokenListItem } from "./tokens";
import type { TrendingToken } from "@/lib/scan/discover.server";

// How many raw token pages (50 items each, 20 credits/page) to pull before
// ranking. Blockscout's default list order isn't volume-sorted and
// stablecoins/majors dominate the front of it — confirmed live: USDE,
// USDG, VIRTUAL, and APE were 4 of the first 5 results — most of which the
// memecoin filter below excludes. A wider pool means the post-filter
// candidate set is actually big enough to fill `limit`, at a small, fixed
// credit cost (5 pages = 100 credits, ~0.1% of the free tier's daily
// budget for one discovery load).
const PAGES_TO_FETCH = 5;

export async function discoverTrendingTokensBlockscout(
  limit: number,
  isNonMeme: (name: string, symbol: string, address: string) => boolean,
): Promise<TrendingToken[]> {
  const candidates: BlockscoutTokenListItem[] = [];
  let pageParams: Record<string, string | number | boolean | undefined> | undefined = {
    type: "ERC-20",
  };

  for (let i = 0; i < PAGES_TO_FETCH; i++) {
    const page = await fetchTokensPage(pageParams);
    candidates.push(...page.items);
    if (!page.next_page_params) break;
    pageParams = { type: "ERC-20", ...page.next_page_params };
  }

  const filtered = candidates.filter((t) => {
    if (!t.name || !t.symbol) return false; // can't classify or display without these
    if (isNonMeme(t.name, t.symbol, t.address_hash.toLowerCase())) return false;
    return true;
  });

  // Real 24h volume — a far stronger "trending" signal than the unique-
  // trader count the live scan derives from an ~800-block snapshot.
  filtered.sort((a, b) => Number(b.volume_24h ?? 0) - Number(a.volume_24h ?? 0));

  return filtered.slice(0, limit).map((t) => {
    const decimals = Number(t.decimals ?? 18);
    let totalSupply = 0;
    try {
      totalSupply = Number(formatUnits(BigInt(t.total_supply ?? "0"), decimals));
    } catch {
      // A malformed total_supply string shouldn't drop the whole token —
      // 0 here is a display fallback, not something anything computes
      // percentages against downstream (unlike analyze.server.ts's
      // holder-pct math, which does guard totalSupply > 0 separately).
      totalSupply = 0;
    }
    return {
      address: getAddress(t.address_hash),
      name: t.name ?? "",
      symbol: t.symbol ?? "",
      decimals,
      totalSupply,
      holdersCount: Number(t.holders_count ?? 0),
      volume24hUsd: t.volume_24h != null ? Number(t.volume_24h) : null,
    };
  });
}
