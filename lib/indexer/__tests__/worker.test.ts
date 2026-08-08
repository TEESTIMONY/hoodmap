// Verifies the ingest worker against a REAL Postgres engine (PGlite —
// actual Postgres compiled to WASM, running in-process; not a mock, not
// sqlite-with-different-semantics) and REAL Robinhood Chain RPC calls.
// No DATABASE_URL / external Postgres needed to run this — that's the
// point of injecting `db` into worker.ts instead of importing a singleton.
import { describe, it, expect, beforeEach } from "vitest";
import { sql as rawSql } from "drizzle-orm";
import * as schema from "../schema";
import { runSyncOnce, runUntilCaughtUpOrBudget, getSyncStatus, CHUNK_BLOCKS } from "../worker";
import { getLatestBlockNumber } from "@/lib/scan/rpc.server";
import { freshTestDb } from "./test-db";
import type { Db } from "../db";

describe("indexer worker (real PGlite Postgres + real Robinhood Chain RPC)", () => {
  let db: Db;

  beforeEach(async () => {
    db = await freshTestDb();
    // Default 10s hook timeout is too tight when multiple test files spin
    // up their own PGlite (WASM Postgres) instance concurrently — this is
    // resource contention in the test run, not a real slowdown in the
    // actual code under test.
  }, 30_000);

  it("schema round-trips real data correctly (uint256-range value, idempotent insert)", async () => {
    // Sanity-checks the schema itself before trusting the worker logic
    // built on top of it: a value at the edge of what uint256 allows must
    // survive a write+read without precision loss (this is exactly why
    // NUMERIC(78,0) was chosen over any integer/float type).
    const hugeValue = "115792089237316195423570985008687907853269984665640564039457584007913129639935"; // 2^256 - 1
    await db.insert(schema.transfers).values({
      tokenAddress: "0xaaaa",
      fromAddress: "0xbbbb",
      toAddress: "0xcccc",
      valueRaw: hugeValue,
      blockNumber: 100n,
      txHash: "0xdeadbeef",
      logIndex: 0,
    });
    const rows = await db.select().from(schema.transfers);
    expect(rows).toHaveLength(1);
    expect(rows[0].valueRaw).toBe(hugeValue);

    // Idempotency: re-inserting the identical (txHash, logIndex) must be a
    // no-op, not a duplicate row or an error — this is the property that
    // makes the worker safe to restart/retry.
    await db
      .insert(schema.transfers)
      .values({
        tokenAddress: "0xaaaa",
        fromAddress: "0xbbbb",
        toAddress: "0xcccc",
        valueRaw: hugeValue,
        blockNumber: 100n,
        txHash: "0xdeadbeef",
        logIndex: 0,
      })
      .onConflictDoNothing();
    const rowsAfter = await db.select().from(schema.transfers);
    expect(rowsAfter).toHaveLength(1);
  });

  it("runSyncOnce ingests one real chunk from the live chain and advances sync_state", async () => {
    const latest = await getLatestBlockNumber();
    // Force the worker to only need one chunk by starting it right at the
    // safety lag boundary — keeps this test fast and deterministic about
    // how many chunks get processed, while still hitting real RPC.
    const startBlock = latest - CHUNK_BLOCKS - 3n;

    const result = await runSyncOnce(db, startBlock);
    console.log("Sync result:", {
      synced: result.synced,
      fromBlock: result.fromBlock.toString(),
      toBlock: result.toBlock.toString(),
      rowsInserted: result.rowsInserted,
    });

    expect(result.synced).toBe(true);
    expect(result.toBlock - result.fromBlock).toBeLessThan(CHUNK_BLOCKS);

    const rows = await db.select().from(schema.transfers);
    console.log(`Rows actually persisted: ${rows.length}`);
    expect(rows.length).toBe(result.rowsInserted);

    if (rows.length > 0) {
      const sample = rows[0];
      console.log("Sample persisted row:", {
        token: sample.tokenAddress,
        from: sample.fromAddress,
        to: sample.toAddress,
        block: sample.blockNumber.toString(),
        tx: sample.txHash,
      });
      // Every row in this DB-shaped schema should look like a real
      // address/hash, not a placeholder or malformed value.
      expect(sample.tokenAddress).toMatch(/^0x[a-f0-9]{40}$/);
      expect(sample.fromAddress).toMatch(/^0x[a-f0-9]{40}$/);
      expect(sample.txHash).toMatch(/^0x[a-f0-9]{64}$/);
    }

    const status = await getSyncStatus(db);
    expect(status.lastSyncedBlock).toBe(result.toBlock);
  }, 60_000);

  it("re-running the same range twice does not duplicate rows (real RPC, real re-fetch)", async () => {
    const latest = await getLatestBlockNumber();
    const startBlock = latest - CHUNK_BLOCKS - 3n;

    const first = await runSyncOnce(db, startBlock);
    const rowsAfterFirst = await db.select().from(schema.transfers);

    // Manually reset sync_state to force the worker to re-process the
    // exact same block range it just did — simulates a worker restart
    // that hadn't yet advanced past this chunk, or a deliberate re-sync.
    await db
      .update(schema.syncState)
      .set({ lastSyncedBlock: startBlock - 1n })
      .where(rawSql`id = 'global'`);

    const second = await runSyncOnce(db, startBlock);
    const rowsAfterSecond = await db.select().from(schema.transfers);

    console.log(
      `First pass: ${first.rowsInserted} inserted. Second pass (same range): ${second.rowsInserted} reported, ${rowsAfterSecond.length} total rows in DB (was ${rowsAfterFirst.length}).`,
    );

    // The row count in the DB must be identical before and after the
    // re-run — this is the actual idempotency guarantee, not just that
    // the function didn't throw.
    expect(rowsAfterSecond.length).toBe(rowsAfterFirst.length);
  }, 60_000);

  it("runUntilCaughtUpOrBudget (the GitHub Actions cron entrypoint's core logic) catches up and reports caughtUp:true", async () => {
    const latest = await getLatestBlockNumber();
    // Small starting gap (a few chunks worth) so this actually exercises
    // "process several chunks, then hit the tip" rather than finishing on
    // the very first call.
    const startBlock = latest - CHUNK_BLOCKS * 3n - 5n;

    const result = await runUntilCaughtUpOrBudget(db, startBlock, 60_000);
    console.log("runUntilCaughtUpOrBudget result:", {
      chunksProcessed: result.chunksProcessed,
      rowsInserted: result.rowsInserted,
      finalBlock: result.finalBlock?.toString(),
      caughtUp: result.caughtUp,
    });

    expect(result.caughtUp).toBe(true);
    expect(result.chunksProcessed).toBeGreaterThan(0);

    const rows = await db.select().from(schema.transfers);
    expect(rows.length).toBe(result.rowsInserted);

    const status = await getSyncStatus(db);
    expect(status.lastSyncedBlock).toBe(result.finalBlock);
  }, 90_000);

  it("runUntilCaughtUpOrBudget stops at the time budget when there's more work than fits", async () => {
    const latest = await getLatestBlockNumber();
    // A much wider gap than a tiny time budget can plausibly finish —
    // forces the "budget reached, more work remains" exit path.
    const startBlock = latest - CHUNK_BLOCKS * 200n;

    const result = await runUntilCaughtUpOrBudget(db, startBlock, 3_000);
    console.log("Budget-limited result:", {
      chunksProcessed: result.chunksProcessed,
      caughtUp: result.caughtUp,
    });

    expect(result.caughtUp).toBe(false);
    // Progress made so far must still be durable — a future run picks up
    // from here, nothing is lost by stopping early.
    if (result.finalBlock != null) {
      const status = await getSyncStatus(db);
      expect(status.lastSyncedBlock).toBe(result.finalBlock);
    }
  }, 20_000);

  it("records each wallet's first funder correctly, matching a hand computation from the same real transfers", async () => {
    const latest = await getLatestBlockNumber();
    const startBlock = latest - CHUNK_BLOCKS * 3n - 5n;
    for (let i = 0; i < 3; i++) {
      await runSyncOnce(db, startBlock);
    }

    const transferRows = await db.select().from(schema.transfers);
    const funderRows = await db.select().from(schema.walletFunders);
    console.log(`Ingested ${transferRows.length} transfers, recorded ${funderRows.length} funder relationships.`);
    expect(funderRows.length).toBeGreaterThan(0);

    // Hand-compute "first sender per (token, wallet)" independently, the
    // same way recordFirstFunders is supposed to, and cross-check every
    // recorded row against it — not just that funder rows exist, but that
    // they're the RIGHT ones.
    const sorted = [...transferRows].sort((a, b) =>
      a.blockNumber !== b.blockNumber
        ? a.blockNumber < b.blockNumber
          ? -1
          : 1
        : a.logIndex - b.logIndex,
    );
    const ZERO = "0x0000000000000000000000000000000000000000";
    const expected = new Map<string, { funder: string; block: bigint }>();
    for (const t of sorted) {
      if (t.fromAddress === ZERO) continue;
      const key = `${t.tokenAddress}:${t.toAddress}`;
      if (expected.has(key)) continue;
      expected.set(key, { funder: t.fromAddress, block: t.blockNumber });
    }

    let checked = 0;
    for (const row of funderRows) {
      const key = `${row.tokenAddress}:${row.walletAddress}`;
      const exp = expected.get(key);
      expect(exp).toBeDefined();
      expect(row.funderAddress).toBe(exp!.funder);
      expect(row.firstFundedBlock).toBe(exp!.block);
      checked++;
    }
    console.log(`Cross-checked ${checked} funder relationships against hand computation — all matched.`);
    expect(checked).toBe(funderRows.length);

    // No mint-as-funder rows — the exact exclusion recordFirstFunders and
    // the live detectWalletClusters both apply.
    expect(funderRows.every((r) => r.funderAddress !== ZERO)).toBe(true);
  }, 60_000);

  it("re-running an overlapping range does not overwrite an already-recorded funder with a later sender", async () => {
    const latest = await getLatestBlockNumber();
    const startBlock = latest - CHUNK_BLOCKS - 5n;

    const first = await runSyncOnce(db, startBlock);
    const funderRowsAfterFirst = await db.select().from(schema.walletFunders);

    // Reset sync_state to force a genuine re-processing of the exact same
    // range (not just a cache hit) — this is the actual idempotency
    // property under test: an already-recorded funder must survive a
    // reprocess unchanged, not get clobbered by whatever this second pass
    // happens to see as "the first" sender in its own local ordering.
    await db
      .update(schema.syncState)
      .set({ lastSyncedBlock: startBlock - 1n })
      .where(rawSql`id = 'global'`);
    await runSyncOnce(db, startBlock);
    const funderRowsAfterSecond = await db.select().from(schema.walletFunders);

    console.log(
      `Funder rows after first pass: ${funderRowsAfterFirst.length}, after re-processing the same range: ${funderRowsAfterSecond.length}.`,
    );
    expect(funderRowsAfterSecond.length).toBe(funderRowsAfterFirst.length);
    const byKey = new Map(funderRowsAfterFirst.map((r) => [`${r.tokenAddress}:${r.walletAddress}`, r.funderAddress]));
    for (const row of funderRowsAfterSecond) {
      expect(row.funderAddress).toBe(byKey.get(`${row.tokenAddress}:${row.walletAddress}`));
    }
    expect(first.synced).toBe(true);
  }, 60_000);
});
