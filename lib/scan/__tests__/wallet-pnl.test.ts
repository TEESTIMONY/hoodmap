import { describe, expect, it } from "vitest";
import { reconstructTrades, type WalletTransferLeg } from "../wallet-pnl";

const WETH = "0xweth";
const TOKEN = "0xtoken";
const TOKEN_B = "0xtokenb";
const USDC = "0xusdc";

// Convenience builder: a swap is exactly one "out" leg and one "in" leg
// sharing a tx hash, matching what a real router-mediated trade produces.
function swap(opts: {
  tx: string;
  block: number;
  ts: number;
  outToken: string;
  outAmount: number;
  inToken: string;
  inAmount: number;
}): WalletTransferLeg[] {
  return [
    {
      token: opts.outToken,
      txHash: opts.tx,
      blockNumber: opts.block,
      timestamp: opts.ts,
      direction: "out",
      amount: opts.outAmount,
    },
    {
      token: opts.inToken,
      txHash: opts.tx,
      blockNumber: opts.block,
      timestamp: opts.ts,
      direction: "in",
      amount: opts.inAmount,
    },
  ];
}

describe("reconstructTrades", () => {
  it("prices a buy then a full sell as one closed trade using a seeded quote token", () => {
    const legs = [
      // Buy 100 TOKEN for 1 WETH -> price 0.01 WETH/TOKEN
      ...swap({ tx: "buy1", block: 1, ts: 1000, outToken: WETH, outAmount: 1, inToken: TOKEN, inAmount: 100 }),
      // Sell 100 TOKEN for 2 WETH -> price 0.02 WETH/TOKEN
      ...swap({ tx: "sell1", block: 2, ts: 2000, outToken: TOKEN, outAmount: 100, inToken: WETH, inAmount: 2 }),
    ];

    const result = reconstructTrades(legs, new Set([WETH]));

    expect(result.closedTrades).toHaveLength(1);
    const trade = result.closedTrades[0];
    expect(trade.quoteToken).toBe(WETH);
    expect(trade.quantity).toBeCloseTo(100);
    expect(trade.costBasisQuote).toBeCloseTo(1);
    expect(trade.proceedsQuote).toBeCloseTo(2);
    expect(trade.realizedPnlQuote).toBeCloseTo(1); // a win
    expect(trade.holdSeconds).toBe(1000);
    expect(trade.buyTxHash).toBe("buy1");
    expect(trade.sellTxHash).toBe("sell1");
    expect(result.openPositions).toHaveLength(0);
    expect(result.quoteTokensUsed).toEqual([WETH]);
  });

  it("reports a negative realizedPnlQuote for a losing trade", () => {
    const legs = [
      ...swap({ tx: "buy1", block: 1, ts: 0, outToken: WETH, outAmount: 2, inToken: TOKEN, inAmount: 100 }),
      ...swap({ tx: "sell1", block: 2, ts: 100, outToken: TOKEN, outAmount: 100, inToken: WETH, inAmount: 1 }),
    ];

    const [trade] = reconstructTrades(legs, new Set([WETH])).closedTrades;
    expect(trade.realizedPnlQuote).toBeCloseTo(-1);
  });

  it("matches sells against buys in FIFO order across multiple lots", () => {
    const legs = [
      // Lot A: buy 50 @ price 0.01
      ...swap({ tx: "buyA", block: 1, ts: 1000, outToken: WETH, outAmount: 0.5, inToken: TOKEN, inAmount: 50 }),
      // Lot B: buy 50 @ price 0.02
      ...swap({ tx: "buyB", block: 2, ts: 2000, outToken: WETH, outAmount: 1, inToken: TOKEN, inAmount: 50 }),
      // Sell 75 @ price 0.03 -> should consume all of lot A (50) then 25 of lot B
      ...swap({ tx: "sell1", block: 3, ts: 3000, outToken: TOKEN, outAmount: 75, inToken: WETH, inAmount: 2.25 }),
    ];

    const result = reconstructTrades(legs, new Set([WETH]));
    expect(result.closedTrades).toHaveLength(2);

    const [first, second] = result.closedTrades;
    expect(first.buyTxHash).toBe("buyA");
    expect(first.quantity).toBeCloseTo(50);
    expect(first.buyPriceInQuote).toBeCloseTo(0.01);

    expect(second.buyTxHash).toBe("buyB");
    expect(second.quantity).toBeCloseTo(25);
    expect(second.buyPriceInQuote).toBeCloseTo(0.02);

    // Remaining 25 of lot B should still be open.
    expect(result.openPositions).toHaveLength(1);
    expect(result.openPositions[0].quantity).toBeCloseTo(25);
    expect(result.openPositions[0].avgCostQuote).toBeCloseTo(0.02);
  });

  it("leaves an unmatched buy as an open position", () => {
    const legs = swap({
      tx: "buy1",
      block: 1,
      ts: 1000,
      outToken: WETH,
      outAmount: 1,
      inToken: TOKEN,
      inAmount: 100,
    });

    const result = reconstructTrades(legs, new Set([WETH]));
    expect(result.closedTrades).toHaveLength(0);
    expect(result.openPositions).toHaveLength(1);
    expect(result.openPositions[0]).toMatchObject({
      token: TOKEN,
      quoteToken: WETH,
      quantity: 100,
      avgCostQuote: 0.01,
    });
  });

  it("does not price a token-to-token swap where neither leg is a quote asset", () => {
    const legs = swap({
      tx: "swap1",
      block: 1,
      ts: 1000,
      outToken: TOKEN,
      outAmount: 10,
      inToken: TOKEN_B,
      inAmount: 20,
    });

    const result = reconstructTrades(legs, new Set([WETH]));
    expect(result.closedTrades).toHaveLength(0);
    expect(result.openPositions).toHaveLength(0);
    expect(result.unpricedTransferCount).toBe(2);
  });

  it("does not fabricate a cost basis when selling with no prior recorded buy", () => {
    const legs = swap({
      tx: "sell1",
      block: 1,
      ts: 1000,
      outToken: TOKEN,
      outAmount: 100,
      inToken: WETH,
      inAmount: 1,
    });

    const result = reconstructTrades(legs, new Set([WETH]));
    expect(result.closedTrades).toHaveLength(0);
    expect(result.unpricedTransferCount).toBe(1);
  });

  it("counts a plain single-leg transfer as unpriced activity, not a trade", () => {
    const legs: WalletTransferLeg[] = [
      { token: TOKEN, txHash: "deposit1", blockNumber: 1, timestamp: 1000, direction: "in", amount: 500 },
    ];

    const result = reconstructTrades(legs, new Set([WETH]));
    expect(result.closedTrades).toHaveLength(0);
    expect(result.openPositions).toHaveLength(0);
    expect(result.unpricedTransferCount).toBe(1);
  });

  it("auto-detects a quote asset with no seed at all, from trading pattern alone", () => {
    const TOKEN_C = "0xtokenc";
    // USDC never seeded as a quote token, but it's the counterparty in
    // trades against three different tokens, so it should be recognized as
    // a reference asset purely from the pattern.
    const legs = [
      ...swap({ tx: "buyA", block: 1, ts: 1000, outToken: USDC, outAmount: 10, inToken: TOKEN, inAmount: 100 }),
      ...swap({ tx: "buyB", block: 2, ts: 2000, outToken: USDC, outAmount: 20, inToken: TOKEN_B, inAmount: 200 }),
      ...swap({ tx: "buyC", block: 3, ts: 2500, outToken: USDC, outAmount: 5, inToken: TOKEN_C, inAmount: 50 }),
      ...swap({ tx: "sell1", block: 4, ts: 3000, outToken: TOKEN, outAmount: 100, inToken: USDC, inAmount: 15 }),
    ];

    const result = reconstructTrades(legs); // no seed at all

    expect(result.closedTrades).toHaveLength(1);
    expect(result.closedTrades[0].quoteToken).toBe(USDC);
    expect(result.closedTrades[0].realizedPnlQuote).toBeCloseTo(5);
    expect(result.openPositions).toHaveLength(2);
    expect(result.quoteTokensUsed).toEqual([USDC]);
  });

  it("does not treat a token as a quote asset from just two counterparties", () => {
    // TOKEN appears against both WETH and USDC (two counterparties) — below
    // the promotion threshold, so it should stay classified as a traded
    // position, not get promoted to a quote asset itself.
    const legs = [
      ...swap({ tx: "buy1", block: 1, ts: 1000, outToken: WETH, outAmount: 1, inToken: TOKEN, inAmount: 100 }),
      ...swap({ tx: "buy2", block: 2, ts: 2000, outToken: USDC, outAmount: 10, inToken: TOKEN, inAmount: 50 }),
    ];

    const result = reconstructTrades(legs, new Set([WETH, USDC]));
    expect(result.openPositions).toHaveLength(2);
    expect(result.openPositions.every((p) => p.token === TOKEN)).toBe(true);
  });

  it("keeps FIFO lots separate per quote-token pairing for the same traded token", () => {
    // Wallet buys TOKEN against WETH once, and against USDC once — these
    // must not be netted against each other since they're priced in
    // different units.
    const legs = [
      ...swap({ tx: "buyWeth", block: 1, ts: 1000, outToken: WETH, outAmount: 1, inToken: TOKEN, inAmount: 100 }),
      ...swap({ tx: "buyUsdc", block: 2, ts: 2000, outToken: USDC, outAmount: 10, inToken: TOKEN, inAmount: 50 }),
      // Sell against WETH should only match the WETH-denominated lot.
      ...swap({ tx: "sellWeth", block: 3, ts: 3000, outToken: TOKEN, outAmount: 100, inToken: WETH, inAmount: 2 }),
    ];

    const result = reconstructTrades(legs, new Set([WETH, USDC]));
    expect(result.closedTrades).toHaveLength(1);
    expect(result.closedTrades[0].quoteToken).toBe(WETH);
    expect(result.closedTrades[0].quantity).toBeCloseTo(100);

    // The USDC-denominated lot should remain fully open, untouched.
    expect(result.openPositions).toHaveLength(1);
    expect(result.openPositions[0].quoteToken).toBe(USDC);
    expect(result.openPositions[0].quantity).toBeCloseTo(50);
  });
});
