// Shared DexScreener client — used both by the single-token Scan adapter
// (24h stats only) and the Top Tokens list (which also wants 5m/1h/6h
// windows to match a trending-table layout). DexScreener does index this
// chain under chainId "robinhood".

export interface DexWindowStats {
  m5?: number;
  h1?: number;
  h6?: number;
  h24?: number;
}

export interface DexTxnStats {
  m5?: { buys: number; sells: number };
  h1?: { buys: number; sells: number };
  h6?: { buys: number; sells: number };
  h24?: { buys: number; sells: number };
}

export interface DexPairData {
  priceUsd?: number;
  marketCapUsd?: number;
  liquidityUsd?: number;
  createdAgoSeconds?: number;
  dexUrl?: string;
  poolLabel?: string;
  pairAddress?: string;
  priceChange: DexWindowStats;
  volumeUsd: DexWindowStats;
  txns: DexTxnStats;
}

interface RawPair {
  baseToken?: { symbol?: string };
  quoteToken?: { symbol?: string };
  priceUsd?: string;
  fdv?: number;
  liquidity?: { usd?: number };
  pairCreatedAt?: number;
  url?: string;
  dexId?: string;
  pairAddress?: string;
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  volume?: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns?: {
    m5?: { buys?: number; sells?: number };
    h1?: { buys?: number; sells?: number };
    h6?: { buys?: number; sells?: number };
    h24?: { buys?: number; sells?: number };
  };
}

export async function fetchDexScreenerToken(address: string): Promise<DexPairData | null> {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
  if (!res.ok) return null;
  const json: unknown = await res.json();
  const pairs = Array.isArray((json as { pairs?: unknown[] })?.pairs)
    ? (json as { pairs: unknown[] }).pairs
    : [];
  if (pairs.length === 0) return null;

  const top = pairs
    .slice()
    .sort(
      (a: unknown, b: unknown) =>
        ((b as RawPair)?.liquidity?.usd ?? 0) - ((a as RawPair)?.liquidity?.usd ?? 0),
    )[0] as RawPair;

  const base = top?.baseToken ?? {};
  const quote = top?.quoteToken ?? {};
  const createdMs = top?.pairCreatedAt ? Number(top.pairCreatedAt) : undefined;

  return {
    priceUsd: top?.priceUsd ? Number(top.priceUsd) : undefined,
    marketCapUsd: top?.fdv ? Number(top.fdv) : undefined,
    liquidityUsd: top?.liquidity?.usd ? Number(top.liquidity.usd) : undefined,
    createdAgoSeconds: createdMs ? Math.floor((Date.now() - createdMs) / 1000) : undefined,
    dexUrl: top?.url,
    poolLabel: `${base?.symbol ?? "?"}/${quote?.symbol ?? "?"} on ${top?.dexId ?? "DEX"}`,
    pairAddress: top?.pairAddress,
    priceChange: {
      m5: top?.priceChange?.m5,
      h1: top?.priceChange?.h1,
      h6: top?.priceChange?.h6,
      h24: top?.priceChange?.h24,
    },
    volumeUsd: {
      m5: top?.volume?.m5,
      h1: top?.volume?.h1,
      h6: top?.volume?.h6,
      h24: top?.volume?.h24,
    },
    txns: {
      m5: top?.txns?.m5 ? { buys: top.txns.m5.buys ?? 0, sells: top.txns.m5.sells ?? 0 } : undefined,
      h1: top?.txns?.h1 ? { buys: top.txns.h1.buys ?? 0, sells: top.txns.h1.sells ?? 0 } : undefined,
      h6: top?.txns?.h6 ? { buys: top.txns.h6.buys ?? 0, sells: top.txns.h6.sells ?? 0 } : undefined,
      h24: top?.txns?.h24
        ? { buys: top.txns.h24.buys ?? 0, sells: top.txns.h24.sells ?? 0 }
        : undefined,
    },
  };
}
