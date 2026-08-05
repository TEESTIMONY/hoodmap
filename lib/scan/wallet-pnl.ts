// Pure trade-reconstruction engine for the Wallet Intelligence Scanner.
// Deliberately has no RPC/server dependency so the highest-risk logic here
// (quote-token detection, swap pairing, FIFO cost basis) can be unit tested
// directly against plain data, without mocking a blockchain client.
//
// Grouping: a swap through a router — even a multi-hop one — still reduces
// to exactly one leg leaving the wallet and one leg arriving at it, because
// only the initial input and final output ever touch the wallet address
// directly; the intermediate hops move between the router and pool
// contracts. So "exactly one out-leg and one in-leg of different tokens in
// one tx" reliably identifies a candidate swap without needing to
// understand the DEX's routing.
//
// Pricing: a swap is only priced when one leg is a *quote* asset — the
// reference asset a pair trades against. Rather than hardcode a single
// token (e.g. one chain's wrapped-native address), quote tokens are
// auto-detected from the wallet's own swap history: any token that shows
// up paired against several *different* counter-tokens is acting as a
// reference asset, the same signal discover.server.ts uses to recognize
// infrastructure tokens. `seedQuoteTokens` lets a caller guarantee a known
// reference asset (e.g. wrapped-native) is always recognized even for a
// wallet with too few trades to trigger the frequency heuristic on its own.
// Token-to-token swaps where neither leg is a quote asset, and plain
// transfers (deposits, withdrawals, airdrops), are counted as wallet
// activity but excluded from PnL rather than assigned a fabricated cost
// basis.

export interface WalletTransferLeg {
  token: string; // contract address, lowercase
  txHash: string;
  blockNumber: number;
  timestamp: number; // unix seconds
  direction: "in" | "out";
  amount: number; // decimal-adjusted
}

export interface ClosedTradeResult {
  token: string;
  quoteToken: string;
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

export interface OpenPositionResult {
  token: string;
  quoteToken: string;
  quantity: number;
  avgCostQuote: number;
  openedAt: number;
}

export interface ReconstructResult {
  closedTrades: ClosedTradeResult[];
  openPositions: OpenPositionResult[];
  unpricedTransferCount: number;
  // Every quote token actually used to price at least one trade — seeded
  // tokens that never matched anything aren't included. Callers use this to
  // know which tokens need a USD price fetched for the summary conversion.
  quoteTokensUsed: string[];
}

interface Lot {
  quantity: number;
  priceInQuote: number;
  timestamp: number;
  txHash: string;
}

interface SwapEvent {
  token: string;
  quoteToken: string;
  side: "buy" | "sell";
  quantity: number;
  priceInQuote: number;
  txHash: string;
  timestamp: number;
  blockNumber: number;
}

interface CandidateSwap {
  txHash: string;
  outLeg: WalletTransferLeg;
  inLeg: WalletTransferLeg;
}

const DUST = 1e-12;
// A token paired against this many distinct counter-tokens in the wallet's
// own history is treated as a reference/quote asset for this scan. A real
// quote asset typically appears against dozens of different tokens; a
// genuinely-traded position is usually only ever bought/sold against a
// small handful of quote assets (1-3). The threshold needs to sit above
// that normal range, or a token traded against two different reference
// assets (e.g. bought with both WETH and a stablecoin) gets misclassified
// as a quote asset itself.
const MIN_COUNTERPARTIES_FOR_QUOTE = 3;

export function reconstructTrades(
  legs: WalletTransferLeg[],
  seedQuoteTokens: ReadonlySet<string> = new Set(),
): ReconstructResult {
  const byTx = new Map<string, WalletTransferLeg[]>();
  for (const leg of legs) {
    const arr = byTx.get(leg.txHash) ?? [];
    arr.push(leg);
    byTx.set(leg.txHash, arr);
  }

  const candidates: CandidateSwap[] = [];
  let unpricedTransferCount = 0;

  for (const [txHash, txLegs] of byTx) {
    const outLegs = txLegs.filter((l) => l.direction === "out");
    const inLegs = txLegs.filter((l) => l.direction === "in");
    if (outLegs.length === 1 && inLegs.length === 1 && outLegs[0].token !== inLegs[0].token) {
      candidates.push({ txHash, outLeg: outLegs[0], inLeg: inLegs[0] });
    } else {
      unpricedTransferCount += txLegs.length;
    }
  }

  // Auto-detect quote tokens: a token paired against >= N distinct
  // counter-tokens across this wallet's own swaps is acting as a reference
  // asset, whatever chain or token it happens to be.
  const counterparties = new Map<string, Set<string>>();
  for (const { outLeg, inLeg } of candidates) {
    const a = counterparties.get(outLeg.token) ?? new Set<string>();
    a.add(inLeg.token);
    counterparties.set(outLeg.token, a);
    const b = counterparties.get(inLeg.token) ?? new Set<string>();
    b.add(outLeg.token);
    counterparties.set(inLeg.token, b);
  }
  const quoteTokens = new Set(seedQuoteTokens);
  for (const [token, peers] of counterparties) {
    if (peers.size >= MIN_COUNTERPARTIES_FOR_QUOTE) quoteTokens.add(token);
  }

  const swaps: SwapEvent[] = [];
  for (const { txHash, outLeg, inLeg } of candidates) {
    const outIsQuote = quoteTokens.has(outLeg.token);
    const inIsQuote = quoteTokens.has(inLeg.token);
    const timestamp = Math.min(outLeg.timestamp, inLeg.timestamp);
    const blockNumber = Math.min(outLeg.blockNumber, inLeg.blockNumber);

    if (outIsQuote && !inIsQuote && outLeg.amount > 0 && inLeg.amount > 0) {
      swaps.push({
        token: inLeg.token,
        quoteToken: outLeg.token,
        side: "buy",
        quantity: inLeg.amount,
        priceInQuote: outLeg.amount / inLeg.amount,
        txHash,
        timestamp,
        blockNumber,
      });
    } else if (inIsQuote && !outIsQuote && outLeg.amount > 0 && inLeg.amount > 0) {
      swaps.push({
        token: outLeg.token,
        quoteToken: inLeg.token,
        side: "sell",
        quantity: outLeg.amount,
        priceInQuote: inLeg.amount / outLeg.amount,
        txHash,
        timestamp,
        blockNumber,
      });
    } else {
      // Neither leg is a recognized quote asset (token-to-token swap
      // between two "position" tokens), or both are (ambiguous which side
      // is the position) — can't price without picking a side arbitrarily.
      unpricedTransferCount += 2;
    }
  }

  swaps.sort((a, b) => a.blockNumber - b.blockNumber || a.timestamp - b.timestamp);

  // FIFO lots are keyed by (token, quoteToken) — the same token bought
  // against two different quote assets isn't fungible for cost-basis
  // matching without a cross-rate, so each quote pairing gets its own queue.
  const openLots = new Map<string, Lot[]>();
  const lotKey = (token: string, quoteToken: string) => `${token}::${quoteToken}`;
  const closedTrades: ClosedTradeResult[] = [];
  const quoteTokensUsed = new Set<string>();

  for (const swap of swaps) {
    const key = lotKey(swap.token, swap.quoteToken);
    if (swap.side === "buy") {
      const lots = openLots.get(key) ?? [];
      lots.push({
        quantity: swap.quantity,
        priceInQuote: swap.priceInQuote,
        timestamp: swap.timestamp,
        txHash: swap.txHash,
      });
      openLots.set(key, lots);
      continue;
    }

    let remaining = swap.quantity;
    const lots = openLots.get(key) ?? [];
    while (remaining > DUST && lots.length > 0) {
      const lot = lots[0];
      const matched = Math.min(lot.quantity, remaining);
      const costBasisQuote = matched * lot.priceInQuote;
      const proceedsQuote = matched * swap.priceInQuote;
      closedTrades.push({
        token: swap.token,
        quoteToken: swap.quoteToken,
        buyTxHash: lot.txHash,
        sellTxHash: swap.txHash,
        quantity: matched,
        buyPriceInQuote: lot.priceInQuote,
        sellPriceInQuote: swap.priceInQuote,
        costBasisQuote,
        proceedsQuote,
        realizedPnlQuote: proceedsQuote - costBasisQuote,
        buyTimestamp: lot.timestamp,
        sellTimestamp: swap.timestamp,
        holdSeconds: Math.max(0, swap.timestamp - lot.timestamp),
      });
      quoteTokensUsed.add(swap.quoteToken);
      lot.quantity -= matched;
      remaining -= matched;
      if (lot.quantity <= DUST) lots.shift();
    }
    if (remaining > DUST) {
      // Sold more than was ever seen bought in the scan window — the
      // position predates the window or was funded outside a priced swap.
      // No cost basis to assign, so this portion isn't a closed trade.
      unpricedTransferCount += 1;
    }
    openLots.set(key, lots);
  }

  const openPositions: OpenPositionResult[] = [];
  for (const [key, lots] of openLots) {
    const remainingLots = lots.filter((l) => l.quantity > DUST);
    if (remainingLots.length === 0) continue;
    const [token, quoteToken] = key.split("::");
    const quantity = remainingLots.reduce((s, l) => s + l.quantity, 0);
    const costTotal = remainingLots.reduce((s, l) => s + l.quantity * l.priceInQuote, 0);
    quoteTokensUsed.add(quoteToken);
    openPositions.push({
      token,
      quoteToken,
      quantity,
      avgCostQuote: quantity > 0 ? costTotal / quantity : 0,
      openedAt: Math.min(...remainingLots.map((l) => l.timestamp)),
    });
  }

  return {
    closedTrades,
    openPositions,
    unpricedTransferCount,
    quoteTokensUsed: Array.from(quoteTokensUsed),
  };
}
