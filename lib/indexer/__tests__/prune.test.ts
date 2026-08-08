// Verifies pruneOldTransfers against a REAL Postgres engine (PGlite) with
// synthetic data — deterministic control over exactly which block numbers
// exist is more useful here than real chain data, since the property under
// test is "the right rows survive relative to a cutoff," not "the numbers
// match a live source."
import { describe, it, expect, beforeEach } from "vitest";
import * as schema from "../schema";
import { pruneOldTransfers } from "../prune";
import { freshTestDb } from "./test-db";
import type { Db } from "../db";

async function insertTransfer(db: Db, blockNumber: bigint, logIndex: number) {
  await db.insert(schema.transfers).values({
    tokenAddress: "0xtoken",
    fromAddress: "0xfrom",
    toAddress: "0xto",
    valueRaw: "1",
    blockNumber,
    txHash: `0xhash${blockNumber}_${logIndex}`,
    logIndex,
  });
}

describe("pruneOldTransfers (real PGlite Postgres, synthetic data)", () => {
  let db: Db;

  beforeEach(async () => {
    db = await freshTestDb();
  }, 30_000);

  it("returns cutoffBlock null and deletes nothing when sync_state has no row yet", async () => {
    await insertTransfer(db, 100n, 0);
    const result = await pruneOldTransfers(db, 50n);
    expect(result.cutoffBlock).toBeNull();
    expect(result.rowsDeleted).toBe(0);

    const rows = await db.select().from(schema.transfers);
    expect(rows).toHaveLength(1);
  });

  it("deletes rows strictly older than (tip - retentionBlocks), keeps the rest", async () => {
    // tip = 1000, retention = 100 -> cutoff = 900. Blocks < 900 get pruned.
    await db.insert(schema.syncState).values({ id: "global", lastSyncedBlock: 1000n });
    for (const b of [500n, 899n, 900n, 901n, 1000n]) {
      await insertTransfer(db, b, 0);
    }

    const result = await pruneOldTransfers(db, 100n);
    console.log("Prune result:", result);
    expect(result.cutoffBlock).toBe(900n);
    expect(result.rowsDeleted).toBe(2); // 500, 899

    const remaining = await db.select().from(schema.transfers);
    const remainingBlocks = remaining.map((r) => r.blockNumber).sort((a, b) => (a < b ? -1 : 1));
    expect(remainingBlocks).toEqual([900n, 901n, 1000n]);
  });

  it("a second run after already pruning deletes nothing further (idempotent)", async () => {
    await db.insert(schema.syncState).values({ id: "global", lastSyncedBlock: 1000n });
    for (const b of [500n, 950n]) await insertTransfer(db, b, 0);

    const first = await pruneOldTransfers(db, 100n);
    expect(first.rowsDeleted).toBe(1);

    const second = await pruneOldTransfers(db, 100n);
    expect(second.rowsDeleted).toBe(0);

    const remaining = await db.select().from(schema.transfers);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].blockNumber).toBe(950n);
  });

  it("cutoff never goes negative when the tip is smaller than the retention window", async () => {
    await db.insert(schema.syncState).values({ id: "global", lastSyncedBlock: 50n });
    await insertTransfer(db, 10n, 0);

    const result = await pruneOldTransfers(db, 100n); // retention > tip
    expect(result.cutoffBlock).toBe(0n);
    expect(result.rowsDeleted).toBe(0); // block 10 is not < 0

    const remaining = await db.select().from(schema.transfers);
    expect(remaining).toHaveLength(1);
  });

  it("deletes across multiple wallets/tokens without regard to which token a row belongs to", async () => {
    await db.insert(schema.syncState).values({ id: "global", lastSyncedBlock: 1000n });
    await db.insert(schema.transfers).values([
      { tokenAddress: "0xa", fromAddress: "0xf", toAddress: "0xt", valueRaw: "1", blockNumber: 100n, txHash: "0x1", logIndex: 0 },
      { tokenAddress: "0xb", fromAddress: "0xf", toAddress: "0xt", valueRaw: "1", blockNumber: 100n, txHash: "0x2", logIndex: 0 },
      { tokenAddress: "0xa", fromAddress: "0xf", toAddress: "0xt", valueRaw: "1", blockNumber: 950n, txHash: "0x3", logIndex: 0 },
    ]);

    const result = await pruneOldTransfers(db, 100n); // cutoff = 900
    expect(result.rowsDeleted).toBe(2);

    const remaining = await db.select().from(schema.transfers);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].tokenAddress).toBe("0xa");
    expect(remaining[0].blockNumber).toBe(950n);
  });
});
