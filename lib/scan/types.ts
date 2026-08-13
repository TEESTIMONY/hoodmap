// Shared Scan analysis types, ported from the original HoodMap analyzer.

import type { DexSocialLink, DexTxnStats, DexWindowStats } from "./dexscreener";

export type WalletRole =
  | "developer"
  | "liquidity"
  | "exchange"
  | "whale"
  | "holder"
  | "sniper"
  | "insider"
  | "burn"
  | "contract";

export interface WalletNode {
  id: string;
  label?: string;
  role: WalletRole;
  balance: number; // token units (decimals-adjusted)
  pctSupply: number; // 0..100
  group?: string;
  // 1-indexed position by raw balance among every resolved holder in this
  // scan window (including liquidity/burn addresses, matching how a block
  // explorer's "top holders" rank works) — undefined only if this node
  // fell outside the resolved candidate set entirely.
  rank?: number;
}

export interface WalletEdge {
  from: string;
  to: string;
  weight: number;
  kind?: "transfer" | "liquidity" | "swap";
}

export interface WalletGroup {
  id: string;
  label: string;
  wallets: string[];
  pctSupply: number;
  risk: "low" | "medium" | "high";
  note: string;
  reason: string; // explainable — WHY these wallets are clustered
}

export interface Transfer {
  hash: string;
  from: string;
  to: string;
  amount: number;
  ageSeconds: number;
  kind: "buy" | "sell" | "transfer" | "mint" | "burn";
  blockNumber?: number;
  // Position of this Transfer event within its transaction's logs. A single
  // transaction can emit multiple Transfer events for the same token (e.g. a
  // multi-hop swap), which share a hash and blockNumber but not a logIndex —
  // needed to give each one a unique React list key.
  logIndex: number;
}

export interface HolderBucket {
  label: string;
  pct: number;
}

export interface LiquiditySummary {
  totalUsd: number;
  lockedPct: number;
  lockedUntil?: string;
  pool: string;
  pairAddress?: string;
}

export interface HoodScore {
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  category: string; // e.g. "Healthy distribution"
  reason: string; // one-paragraph explanation
  signals: { label: string; kind: "good" | "warn" | "bad"; detail?: string }[];
}

export interface TokenMeta {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply?: number;
  priceUsd?: number;
  // Price in units of whatever the token's best-liquidity pair is quoted
  // against (see quoteSymbol) — usually WETH, but not assumed to be.
  priceNative?: number;
  quoteSymbol?: string;
  marketCapUsd?: number;
  fdvUsd?: number;
  liquidityUsd?: number;
  createdAgoSeconds?: number;
  source: "mock" | "dexscreener" | "robinhood-chain";
  dexUrl?: string;
  priceChange24h?: number;
  volume24hUsd?: number;
  txns24h?: { buys: number; sells: number };
  // Multi-window versions of the three fields above (5m/1h/6h/24h) — for
  // the sidebar's DexScreener-style stats card. priceChange24h/
  // volume24hUsd/txns24h stay as their own fields too since existing
  // callers (TokenHeader) already read them directly.
  priceChangeWindows?: DexWindowStats;
  volumeUsdWindows?: DexWindowStats;
  txnsWindows?: DexTxnStats;
  websiteUrl?: string;
  socials?: DexSocialLink[];
  // Only present when DexScreener has enhanced token info for this
  // contract — absent for most memecoins. Consumers fall back to a
  // generated avatar when this is undefined.
  imageUrl?: string;
}

export type DataStatus = "live" | "partial" | "unavailable" | "mock";

export interface DataSources {
  metadata: DataStatus;
  price: DataStatus;
  liquidity: DataStatus;
  holders: DataStatus;
  walletGraph: DataStatus;
  transfers: DataStatus;
  provider?: string;
  rpcUrl?: string;
  observationWindowBlocks?: number;
  observationWindowFromBlock?: number;
  observationWindowToBlock?: number;
  lastUpdated: string; // ISO
  notes?: string[];
}

export interface WhaleRow {
  address: string;
  balance: number;
  pctSupply: number;
  nativeBalance?: number; // in native chain token
  connectedWallets: number;
  recentTxs: number;
  labels: string[];
  role: WalletRole;
  // Same 1-indexed overall-holder rank as WalletNode.rank — see that comment.
  rank?: number;
}

export interface HealthMetric {
  key: string;
  label: string;
  status: "excellent" | "good" | "moderate" | "risk" | "unknown";
  detail: string;
}

export interface AnalysisWarning {
  severity: "info" | "warn" | "high";
  message: string;
}

export interface AnalysisResult {
  token: TokenMeta;
  hoodScore: HoodScore;
  holderDistribution: HolderBucket[];
  holderTotals?: {
    uniqueObserved: number;
    top10Pct: number;
    top25Pct: number;
    top100Pct: number;
    developerPct: number;
    liquidityPct: number;
    burnPct: number;
  };
  groups: WalletGroup[];
  developer: WalletNode;
  liquidity: LiquiditySummary;
  transfers: Transfer[];
  // Every transfer scanned in the observation window (not just the top-25
  // shown in the "Recent transfers" panel) — lets HoodMap's per-wallet
  // Transfers view filter down to one wallet without a second on-chain query.
  allTransfers: Transfer[];
  graph: { nodes: WalletNode[]; edges: WalletEdge[] };
  aiSummary: string;
  dataSources: DataSources;
  whales: WhaleRow[];
  health: HealthMetric[];
  warnings: AnalysisWarning[];
}
