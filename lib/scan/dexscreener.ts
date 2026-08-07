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
  imageUrl?: string;
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
  // Only present when a project has submitted enhanced token info to
  // DexScreener — most memecoins on this chain haven't, so this is
  // frequently absent. Callers fall back to a generated avatar.
  info?: { imageUrl?: string };
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  volume?: { m5?: number; h1?: number; h6?: number; h24?: number };
  txns?: {
    m5?: { buys?: number; sells?: number };
    h1?: { buys?: number; sells?: number };
    h6?: { buys?: number; sells?: number };
    h24?: { buys?: number; sells?: number };
  };
}

// DexScreener's own fetch() had no timeout at all — a single slow or
// hanging response could stall whatever awaited it indefinitely. Confirmed
// live: an ad hoc script calling this in a loop hung past 3 minutes with
// zero output until this timeout was added. This is called both server-side
// (a scan/discovery request) and directly from the browser (TopTokens.tsx),
// so an unbounded hang here could leave either one stuck with no fallback.
const FETCH_TIMEOUT_MS = 8_000;

export async function fetchDexScreenerToken(address: string): Promise<DexPairData | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, {
      signal: controller.signal,
    });
  } catch {
    // Covers both the abort (timeout) and any network-level failure —
    // callers already treat a null return as "no market data available",
    // so this degrades the same way a slow response used to hang instead.
    return null;
  } finally {
    clearTimeout(timer);
  }
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
    imageUrl: top?.info?.imageUrl,
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
