// Shared Scan analysis types, ported from the original HoodMap analyzer.

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
  marketCapUsd?: number;
  liquidityUsd?: number;
  createdAgoSeconds?: number;
  source: "mock" | "dexscreener" | "robinhood-chain";
  dexUrl?: string;
  priceChange24h?: number;
  volume24hUsd?: number;
  txns24h?: { buys: number; sells: number };
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
  graph: { nodes: WalletNode[]; edges: WalletEdge[] };
  aiSummary: string;
  dataSources: DataSources;
  whales: WhaleRow[];
  health: HealthMetric[];
  warnings: AnalysisWarning[];
}
