// Wallet Intelligence Scanner (Module C) — orchestration layer. Fetches a
// wallet's full cross-token transfer history, converts it to decimal-
// adjusted legs, and hands it to the pure reconstructTrades() engine in
// wallet-pnl.ts, which auto-detects which tokens are acting as quote/
// reference assets from the wallet's own trading pattern (WETH is seeded
// as a guaranteed baseline, but isn't the only recognized quote asset —
// see the comment at the top of wallet-pnl.ts). Server-only.

import { formatUnits, getAddress } from "viem";
import {
  batchBlockTimestamps,
  fetchWalletTransferLogs,
  getLatestBlockNumber,
  readTokenDecimalsAndSymbolStrict,
  readTokenMetadata,
  WETH_ADDRESS,
  type RawWalletTransfer,
} from "./rpc.server";
import { fetchDexScreenerToken } from "./dexscreener";
import { reconstructTrades, type WalletTransferLeg } from "./wallet-pnl";
import type {
  ClosedTrade,
  OpenPosition,
  QuotePnlBreakdown,
  TokenRef,
  WalletPnlSummary,
  WalletTransferRow,
} from "./wallet-types";

// A wallet's full trading history typically spans far more blocks than "who
// holds this token right now" (the token scanner's ~5,000 block window).
// Scans always cover the full 5M-block budget — a wallet can have real
// activity in the first 500k blocks and *substantially* more further back
// (measured: one wallet had 55 transfers in 500k blocks but 481 within 5M),
// so stopping the moment any activity is found undercounts real wallets
// rather than just skipping genuinely-empty ones. 5M is a hard ceiling, not
// a starting point to grow from — this chain is currently at ~27.8M blocks,
// and a live probe at 15M blocks back returned unreliable results (the RPC
// silently drops most of a query that large), so going further isn't
// currently viable for a single request regardless of how badly it's
// wanted. Fetched in tiers (rather than one 5M-block call) so a wallet
// whose real history is small still returns as soon as fetching is done,
// without changing what's ultimately scanned.
const LOOKBACK_TIERS_BLOCKS = [500_000n, 2_000_000n, 5_000_000n] as const;
const METADATA_CONCURRENCY = 5;

export async function analyzeWalletLive(rawAddress: string): Promise<WalletPnlSummary> {
  const wallet = getAddress(rawAddress);
  const walletLower = wallet.toLowerCase();
  const weth = WETH_ADDRESS.toLowerCase();

  const latest = await getLatestBlockNumber();

  let rawTransfers: RawWalletTransfer[] = [];
  let scannedFrom = latest + 1n; // nothing scanned yet
  let failedFetches = 0;
  let totalFetches = 0;

  for (const tierBlocks of LOOKBACK_TIERS_BLOCKS) {
    const tierFrom = latest > tierBlocks ? latest - tierBlocks : 0n;
    if (tierFrom >= scannedFrom) break;
    const chunk = await fetchWalletTransferLogs(wallet, tierFrom, scannedFrom - 1n);
    rawTransfers = [...chunk.transfers, ...rawTransfers];
    failedFetches += chunk.failedFetches;
    totalFetches += chunk.totalFetches;
    scannedFrom = tierFrom;
    if (tierFrom === 0n) break;
  }

  const fromBlock = scannedFrom;
  const truncated = rawTransfers.length >= 20_000;

  // Drop self-transfers (from === to === wallet) — not meaningful trade data.
  const relevant = rawTransfers.filter((t) => {
    const from = t.from.toLowerCase();
    const to = t.to.toLowerCase();
    return (from === walletLower) !== (to === walletLower);
  });

  const uniqueTokens = Array.from(new Set(relevant.map((t) => t.token.toLowerCase())));
  if (!uniqueTokens.includes(weth)) uniqueTokens.push(weth);

  // Decimals feed directly into every amount and derived price. A wrong
  // guess here (e.g. assuming 18 when a token actually uses 6) doesn't fail
  // loudly — it silently produces a plausible-looking but wildly wrong
  // price, which is worse than a missing number. So a metadata fetch
  // failure (after one retry, since this has been transient RPC flakiness
  // under heavy request volume) excludes that token's transfers entirely
  // rather than falling back to an assumed decimals value.
  const decimalsByToken = new Map<string, number>();
  const metaByToken = new Map<string, { symbol: string; decimals: number }>();
  const failedTokens = new Set<string>();
  for (let i = 0; i < uniqueTokens.length; i += METADATA_CONCURRENCY) {
    const slice = uniqueTokens.slice(i, i + METADATA_CONCURRENCY);
    const metas = await Promise.all(
      slice.map((addr) =>
        readTokenDecimalsAndSymbolStrict(addr)
          .catch(() => readTokenDecimalsAndSymbolStrict(addr))
          .catch(() => null),
      ),
    );
    slice.forEach((addr, idx) => {
      const m = metas[idx];
      if (!m) {
        failedTokens.add(addr);
        return;
      }
      decimalsByToken.set(addr, m.decimals);
      metaByToken.set(addr, { symbol: m.symbol, decimals: m.decimals });
    });
  }

  // A strict decimals failure often means the contract genuinely doesn't
  // implement decimals()/symbol() correctly — common for unsolicited spam-
  // token airdrops, not just RPC flakiness. That token's transfers stay
  // excluded from pricing either way (no safe decimals to compute an
  // amount from), but the raw activity table isn't doing arithmetic on the
  // result, so it's worth one lenient, best-effort symbol lookup (the
  // per-field-fallback reader, not the strict one) purely so the table can
  // show a real name instead of a blanket "TOKEN" placeholder.
  const displaySymbolByToken = new Map<string, string>();
  if (failedTokens.size > 0) {
    const failedList = Array.from(failedTokens);
    for (let i = 0; i < failedList.length; i += METADATA_CONCURRENCY) {
      const slice = failedList.slice(i, i + METADATA_CONCURRENCY);
      const metas = await Promise.all(slice.map((addr) => readTokenMetadata(addr).catch(() => null)));
      slice.forEach((addr, idx) => {
        const m = metas[idx];
        if (m && m.symbol && m.symbol !== "TOKEN") displaySymbolByToken.set(addr, m.symbol);
      });
    }
  }

  const timestamps = await batchBlockTimestamps(relevant.map((t) => t.blockNumber));

  // A block whose timestamp failed to resolve (RPC throttling under this
  // much request volume) must NOT silently become epoch-0 — that would
  // make holdSeconds (sellTimestamp - buyTimestamp) come out as decades.
  // Drop those legs instead: they're excluded from PnL the same way an
  // unpriced transfer is, rather than corrupting a real trade's numbers.
  let droppedForMissingTimestamp = 0;
  let droppedForMissingMetadata = 0;
  const legs: WalletTransferLeg[] = [];
  for (const t of relevant as RawWalletTransfer[]) {
    const token = t.token.toLowerCase();
    if (failedTokens.has(token)) {
      droppedForMissingMetadata++;
      continue;
    }
    const ts = timestamps.get(t.blockNumber.toString());
    if (ts == null) {
      droppedForMissingTimestamp++;
      continue;
    }
    const decimals = decimalsByToken.get(token) ?? 18;
    const from = t.from.toLowerCase();
    legs.push({
      token,
      txHash: t.txHash,
      blockNumber: Number(t.blockNumber),
      timestamp: ts,
      direction: from === walletLower ? "out" : "in",
      amount: Number(formatUnits(t.valueRaw, decimals)),
    });
  }

  // Full raw activity list for the clickable transfers table — every
  // transfer found, not just the subset that priced as a trade. Doesn't
  // apply the same exclude-on-failure rules as `legs`: an "Unknown token" /
  // unresolved timestamp row is honest here, since nothing downstream
  // computes a price from it.
  const transfers: WalletTransferRow[] = (relevant as RawWalletTransfer[])
    .map((t) => {
      const token = t.token.toLowerCase();
      const decimals = decimalsByToken.get(token) ?? 18;
      const meta = metaByToken.get(token);
      const symbol = meta?.symbol ?? displaySymbolByToken.get(token) ?? "TOKEN";
      return {
        hash: t.txHash,
        token: { address: token, symbol, decimals },
        from: t.from,
        to: t.to,
        direction: (t.from.toLowerCase() === walletLower ? "out" : "in") as "in" | "out",
        amount: Number(formatUnits(t.valueRaw, decimals)),
        timestamp: timestamps.get(t.blockNumber.toString()) ?? 0,
      };
    })
    .sort((a, b) => b.timestamp - a.timestamp);

  // WETH is seeded so it's always recognized even for a wallet with too few
  // trades to trigger the frequency-based auto-detection on its own; a
  // token whose own metadata failed can't be used as a quote leg (we
  // wouldn't be able to price against it), so it's excluded from the seed.
  const seedQuoteTokens = new Set<string>(failedTokens.has(weth) ? [] : [weth]);
  const {
    closedTrades: rawClosed,
    openPositions: rawOpen,
    unpricedTransferCount,
    quoteTokensUsed,
  } = reconstructTrades(legs, seedQuoteTokens);

  const tokenRef = (address: string): TokenRef => {
    const m = metaByToken.get(address);
    return { address, symbol: m?.symbol ?? "TOKEN", decimals: m?.decimals ?? 18 };
  };

  const closedTrades: ClosedTrade[] = rawClosed.map((t) => ({
    token: tokenRef(t.token),
    quoteToken: tokenRef(t.quoteToken),
    buyTxHash: t.buyTxHash,
    sellTxHash: t.sellTxHash,
    quantity: t.quantity,
    buyPriceInQuote: t.buyPriceInQuote,
    sellPriceInQuote: t.sellPriceInQuote,
    costBasisQuote: t.costBasisQuote,
    proceedsQuote: t.proceedsQuote,
    realizedPnlQuote: t.realizedPnlQuote,
    buyTimestamp: t.buyTimestamp,
    sellTimestamp: t.sellTimestamp,
    holdSeconds: t.holdSeconds,
  }));

  const openPositions: OpenPosition[] = rawOpen
    .map((p) => ({
      token: tokenRef(p.token),
      quoteToken: tokenRef(p.quoteToken),
      quantity: p.quantity,
      avgCostQuote: p.avgCostQuote,
      openedAt: p.openedAt,
    }))
    .sort((a, b) => b.quantity * b.avgCostQuote - a.quantity * a.avgCostQuote);

  const totalTrades = closedTrades.length;
  const wins = closedTrades.filter((t) => t.realizedPnlQuote > 0).length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
  const avgHoldSeconds =
    totalTrades > 0 ? closedTrades.reduce((s, t) => s + t.holdSeconds, 0) / totalTrades : 0;

  const largestWin = closedTrades.reduce<ClosedTrade | undefined>(
    (best, t) =>
      t.realizedPnlQuote > 0 && (!best || t.realizedPnlQuote > best.realizedPnlQuote) ? t : best,
    undefined,
  );
  const largestLoss = closedTrades.reduce<ClosedTrade | undefined>(
    (worst, t) =>
      t.realizedPnlQuote < 0 && (!worst || t.realizedPnlQuote < worst.realizedPnlQuote) ? t : worst,
    undefined,
  );

  // USD conversion is a labeled approximation: the trade prices themselves
  // are historical and on-chain-derived, but converting each quote asset's
  // total to USD uses its *current* price, not its price at each trade's
  // block. Fetched per detected quote token (usually just one or two).
  const pnlByQuote: QuotePnlBreakdown[] = [];
  for (const quoteAddr of quoteTokensUsed) {
    const tradesForQuote = closedTrades.filter((t) => t.quoteToken.address === quoteAddr);
    const realizedPnlQuote = tradesForQuote.reduce((s, t) => s + t.realizedPnlQuote, 0);
    let usdPrice: number | undefined;
    try {
      const dex = await fetchDexScreenerToken(quoteAddr);
      usdPrice = dex?.priceUsd;
    } catch {
      usdPrice = undefined;
    }
    pnlByQuote.push({
      quoteToken: tokenRef(quoteAddr),
      realizedPnlQuote,
      tradeCount: tradesForQuote.length,
      usdPrice,
      realizedPnlUsd: usdPrice != null ? realizedPnlQuote * usdPrice : undefined,
    });
  }
  const realizedPnlUsd = pnlByQuote.some((q) => q.realizedPnlUsd != null)
    ? pnlByQuote.reduce((s, q) => s + (q.realizedPnlUsd ?? 0), 0)
    : undefined;

  const quoteSymbols = quoteTokensUsed.map((a) => metaByToken.get(a)?.symbol ?? "TOKEN");
  const notes: string[] = [
    quoteSymbols.length > 0
      ? `Prices are derived from paired swap legs against a reference asset within the same transaction, auto-detected from this wallet's own trading pattern (${quoteSymbols.join(", ")}) — accurate at trade time. USD totals use each reference asset's current rate, not its historical rate at each trade.`
      : "No trades in this scan window paired against a recognizable reference asset, so nothing could be priced.",
  ];
  if (relevant.length === 0) {
    const hitGenesis = fromBlock === 0n;
    notes.push(
      hitGenesis
        ? "No activity found for this wallet across the entire chain history."
        : `No activity found for this wallet in the last ${(latest - fromBlock).toLocaleString()} blocks — older history wasn't scanned.`,
    );
  }
  if (unpricedTransferCount > 0) {
    notes.push(
      `${unpricedTransferCount} transfer(s) in the scan window weren't priced (plain transfers, swaps between two tokens neither recognized as a reference asset, or a sell with no prior buy in the window) and are excluded from PnL.`,
    );
  }
  if (truncated) {
    notes.push("Transfer log volume hit the per-scan cap — results may be incomplete for this wallet.");
  }
  if (failedFetches > 0) {
    notes.push(
      `${failedFetches} of ${totalFetches} block-range fetches failed even after a retry (RPC instability under this much request volume) — this scan may be missing some transfers as a result. Re-scanning can pick up different results.`,
    );
  }
  if (droppedForMissingTimestamp > 0) {
    notes.push(
      `${droppedForMissingTimestamp} transfer(s) had a block timestamp that couldn't be read and were excluded rather than risk an inaccurate hold time.`,
    );
  }
  if (droppedForMissingMetadata > 0) {
    notes.push(
      `${droppedForMissingMetadata} transfer(s) referenced a token whose decimals couldn't be read and were excluded rather than risk a wrong price (assuming the wrong decimals silently produces a plausible-looking but incorrect number).`,
    );
  }

  return {
    address: wallet,
    totalTransfersScanned: relevant.length,
    transfers,
    totalTrades,
    winRate,
    realizedPnlUsd,
    pnlByQuote,
    avgHoldSeconds,
    largestWin,
    largestLoss,
    closedTrades: closedTrades.sort((a, b) => b.sellTimestamp - a.sellTimestamp),
    openPositions,
    unpricedTransferCount,
    dataSources: {
      scanFromBlock: Number(fromBlock),
      scanToBlock: Number(latest),
      scanBlocks: Number(latest - fromBlock),
      truncated,
      notes,
    },
  };
}
