import { describe, expect, it } from "vitest";
import { filterTransfersForWallet } from "../wallet-transfers-filter";
import type { Transfer } from "../types";

const WALLET = "0xAbC0000000000000000000000000000000dEf1";
const OTHER_A = "0x1111111111111111111111111111111111111a";
const OTHER_B = "0x2222222222222222222222222222222222222b";

function makeTransfer(overrides: Partial<Transfer>): Transfer {
  return {
    hash: "0xhash",
    from: OTHER_A,
    to: OTHER_B,
    amount: 100,
    ageSeconds: 60,
    kind: "transfer",
    blockNumber: 1,
    logIndex: 0,
    ...overrides,
  };
}

describe("filterTransfersForWallet", () => {
  it("identifies an outgoing transfer with the recipient as counterparty", () => {
    const transfers = [makeTransfer({ from: WALLET, to: OTHER_A })];
    const result = filterTransfersForWallet(transfers, WALLET);
    expect(result).toHaveLength(1);
    expect(result[0].direction).toBe("out");
    expect(result[0].counterparty).toBe(OTHER_A);
  });

  it("identifies an incoming transfer with the sender as counterparty", () => {
    const transfers = [makeTransfer({ from: OTHER_A, to: WALLET })];
    const result = filterTransfersForWallet(transfers, WALLET);
    expect(result).toHaveLength(1);
    expect(result[0].direction).toBe("in");
    expect(result[0].counterparty).toBe(OTHER_A);
  });

  it("excludes transfers that don't involve the wallet at all", () => {
    const transfers = [makeTransfer({ from: OTHER_A, to: OTHER_B })];
    expect(filterTransfersForWallet(transfers, WALLET)).toHaveLength(0);
  });

  it("matches addresses case-insensitively", () => {
    const transfers = [makeTransfer({ from: WALLET.toUpperCase(), to: OTHER_A })];
    const result = filterTransfersForWallet(transfers, WALLET.toLowerCase());
    expect(result).toHaveLength(1);
    expect(result[0].direction).toBe("out");
  });

  it("counts a self-transfer once, as outgoing, not twice", () => {
    const transfers = [makeTransfer({ from: WALLET, to: WALLET })];
    const result = filterTransfersForWallet(transfers, WALLET);
    expect(result).toHaveLength(1);
    expect(result[0].direction).toBe("out");
  });

  it("sorts most recent first (smallest ageSeconds first)", () => {
    const transfers = [
      makeTransfer({ from: WALLET, to: OTHER_A, ageSeconds: 500, hash: "old" }),
      makeTransfer({ from: OTHER_B, to: WALLET, ageSeconds: 10, hash: "newest" }),
      makeTransfer({ from: WALLET, to: OTHER_B, ageSeconds: 120, hash: "mid" }),
    ];
    const result = filterTransfersForWallet(transfers, WALLET);
    expect(result.map((r) => r.transfer.hash)).toEqual(["newest", "mid", "old"]);
  });

  it("returns an empty list for an empty wallet string", () => {
    expect(filterTransfersForWallet([makeTransfer({})], "")).toHaveLength(0);
  });

  it("returns an empty list when given no transfers", () => {
    expect(filterTransfersForWallet([], WALLET)).toHaveLength(0);
  });
});
