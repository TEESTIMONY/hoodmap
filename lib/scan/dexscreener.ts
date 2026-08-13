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

export interface DexSocialLink {
  type: string;
  url: string;
}

export interface DexPairData {
  priceUsd?: number;
  // Queried token's price in units of whatever it's paired against —
  // labeled by quoteSymbol rather than assumed to be ETH, since the
  // best-liquidity pair isn't always a WETH pair.
  priceNative?: number;
  quoteSymbol?: string;
  marketCapUsd?: number;
  fdvUsd?: number;
  liquidityUsd?: number;
  createdAgoSeconds?: number;
  dexUrl?: string;
  poolLabel?: string;
  pairAddress?: string;
  imageUrl?: string;
  websiteUrl?: string;
  socials?: DexSocialLink[];
  priceChange: DexWindowStats;
  volumeUsd: DexWindowStats;
  txns: DexTxnStats;
}

interface RawPair {
  baseToken?: { symbol?: string; address?: string };
  quoteToken?: { symbol?: string; address?: string };
  priceUsd?: string;
  // Base token's price expressed in units of the quote token — needed to
  // derive the QUOTE token's own USD price (see the comment on priceUsd
  // resolution below).
  priceNative?: string;
  fdv?: number;
  // Distinct from fdv — DexScreener's own pair payload carries both as
  // separate numbers (fdv assumes fully diluted supply; marketCap can
  // differ once burns/locks are accounted for). They happen to be equal
  // for tokens with no such difference, which is easy to mistake for the
  // same field — confirmed they're separate keys via a live API response.
  marketCap?: number;
  liquidity?: { usd?: number };
  pairCreatedAt?: number;
  url?: string;
  dexId?: string;
  pairAddress?: string;
  // Only present when a project has submitted enhanced token info to
  // DexScreener — most memecoins on this chain haven't, so this is
  // frequently absent. Callers fall back to a generated avatar.
  info?: {
    imageUrl?: string;
    websites?: { url?: string; label?: string }[];
    socials?: { url?: string; type?: string }[];
  };
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

  // DexScreener's `priceUsd` on a pair is always the BASE token's price —
  // this token-search endpoint returns every pair touching the queried
  // address regardless of which side it's on, so a token that's commonly
  // the QUOTE side of its best-liquidity pair (WETH/native ETH being the
  // extreme, near-universal case) would otherwise silently get the OTHER
  // token's price back. Confirmed live: querying WETH's own address
  // returned priceUsd: 0.1653 — that's CASHCAT's price (the best pair was
  // "CASHCAT/WETH", CASHCAT as base), off by roughly 10,000x from WETH's
  // real ~$1,900. Resolved by checking which side actually matches the
  // queried address: if it's the quote side, invert through priceNative
  // (base token's price in units of quote token) — 1 base token is worth
  // priceNative quote-tokens and priceUsd dollars, so 1 quote-token is
  // worth priceUsd/priceNative dollars.
  const isQueriedTokenTheQuoteSide =
    quote.address?.toLowerCase() === address.toLowerCase() &&
    base.address?.toLowerCase() !== address.toLowerCase();
  const resolvedPriceUsd = (() => {
    if (!top?.priceUsd) return undefined;
    const baseUsd = Number(top.priceUsd);
    if (!isQueriedTokenTheQuoteSide) return baseUsd;
    const priceNative = top?.priceNative ? Number(top.priceNative) : undefined;
    if (!priceNative || priceNative <= 0) return undefined; // can't invert without it — no fabricated guess
    return baseUsd / priceNative;
  })();

  // Same base/quote-side logic as priceUsd above, but for "queried token's
  // price in the OTHER side of the pair" rather than in USD — 1 base is
  // worth priceNative quote-tokens, so if the queried token is the base,
  // priceNative already IS its price in quote-token units; if it's the
  // quote side, invert.
  const resolvedPriceNative = (() => {
    const nativeAsBase = top?.priceNative ? Number(top.priceNative) : undefined;
    if (!nativeAsBase) return undefined;
    if (!isQueriedTokenTheQuoteSide) return nativeAsBase;
    return nativeAsBase > 0 ? 1 / nativeAsBase : undefined;
  })();
  const quoteSymbol = isQueriedTokenTheQuoteSide ? base?.symbol : quote?.symbol;

  return {
    priceUsd: resolvedPriceUsd,
    priceNative: resolvedPriceNative,
    quoteSymbol,
    marketCapUsd: top?.marketCap ? Number(top.marketCap) : undefined,
    fdvUsd: top?.fdv ? Number(top.fdv) : undefined,
    liquidityUsd: top?.liquidity?.usd ? Number(top.liquidity.usd) : undefined,
    createdAgoSeconds: createdMs ? Math.floor((Date.now() - createdMs) / 1000) : undefined,
    dexUrl: top?.url,
    poolLabel: `${base?.symbol ?? "?"}/${quote?.symbol ?? "?"} on ${top?.dexId ?? "DEX"}`,
    pairAddress: top?.pairAddress,
    imageUrl: top?.info?.imageUrl,
    websiteUrl: top?.info?.websites?.find((w) => w?.url)?.url,
    socials: (top?.info?.socials ?? [])
      .filter((s): s is { url: string; type: string } => !!s?.url && !!s?.type)
      .map((s) => ({ type: s.type, url: s.url })),
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
