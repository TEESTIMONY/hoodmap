// Wallet Intelligence Scanner (Module C) types. Structured so the future
// smart-money leaderboard (Module D) can query/rank against WalletPnlSummary
// without restructuring these shapes.

export interface TokenRef {
  address: string;
  symbol: string;
  decimals: number;
}

// A trade is only "priced" when one leg of the swap was a recognized quote
// asset — see the auto-detection note in wallet-analyze.server.ts. Amounts
// and prices are in terms of THAT trade's quote token (which can differ
// between trades — a wallet might buy one position against WETH and
// another against a stablecoin), not USD. USD is a separate, clearly
// labeled conversion using each quote token's *current* rate.
export interface ClosedTrade {
  token: TokenRef;
  quoteToken: TokenRef;
  buyTxHash: string;
  sellTxHash: string;
  quantity: number;
  buyPriceInQuote: number;
  sellPriceInQuote: number;
  costBasisQuote: number;
  proceedsQuote: number;
  realizedPnlQuote: number;
  buyTimestamp: number;
  sellTimestamp: number;
  holdSeconds: number;
}

export interface OpenPosition {
  token: TokenRef;
  quoteToken: TokenRef;
  quantity: number;
  avgCostQuote: number;
  openedAt: number;
}

// Realized PnL summed within one quote asset, plus a USD conversion at that
// asset's current rate (not its historical rate at each trade).
export interface QuotePnlBreakdown {
  quoteToken: TokenRef;
  realizedPnlQuote: number;
  tradeCount: number;
  usdPrice?: number;
  realizedPnlUsd?: number;
}

// One raw Transfer event touching the wallet — the full activity list, not
// just the subset that ended up priced as a trade. Token symbol falls back
// to "TOKEN" and timestamp to 0 if metadata/timestamp resolution failed for
// that specific entry; unlike the pricing engine, a raw activity list has
// no wrong-number risk from showing an honest "unknown" placeholder.
export interface WalletTransferRow {
  hash: string;
  token: TokenRef;
  from: string;
  to: string;
  direction: "in" | "out";
  amount: number;
  timestamp: number;
}

export interface WalletPnlSummary {
  address: string;
  // Every Transfer event touching this wallet in the scan window (either
  // direction, self-transfers excluded) — regardless of whether it ended up
  // priced as a trade. This is what answers "how much activity does this
  // wallet actually have," independent of how much of it could be priced.
  totalTransfersScanned: number;
  transfers: WalletTransferRow[];
  totalTrades: number;
  winRate: number;
  realizedPnlUsd?: number;
  pnlByQuote: QuotePnlBreakdown[];
  avgHoldSeconds: number;
  largestWin?: ClosedTrade;
  largestLoss?: ClosedTrade;
  closedTrades: ClosedTrade[];
  openPositions: OpenPosition[];
  unpricedTransferCount: number;
  dataSources: {
    scanFromBlock: number;
    scanToBlock: number;
    scanBlocks: number;
    truncated: boolean;
    notes: string[];
  };
}
