// Verifies the ingest worker against a REAL Postgres engine (PGlite —
// actual Postgres compiled to WASM, running in-process; not a mock, not
// sqlite-with-different-semantics) and REAL Robinhood Chain RPC calls.
// No DATABASE_URL / external Postgres needed to run this — that's the
// point of injecting `db` into worker.ts instead of importing a singleton.
import { describe, it, expect, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql as rawSql } from "drizzle-orm";
import * as schema from "../schema";
import { runSyncOnce, getSyncStatus, CHUNK_BLOCKS } from "../worker";
import { getLatestBlockNumber } from "@/lib/scan/rpc.server";
import type { Db } from "../db";

// Mirrors schema.ts exactly — drizzle-kit's migration generation targets a
// real Postgres server, which isn't available in this test environment;
// DDL is applied directly here instead so PGlite has the same shape.
const DDL = `
  CREATE TABLE transfers (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    token_address TEXT NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT NOT NULL,
    value_raw NUMERIC(78, 0) NOT NULL,
    block_number BIGINT NOT NULL,
    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    block_timestamp TIMESTAMPTZ,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX transfers_tx_log_idx ON transfers (tx_hash, log_index);
  CREATE INDEX transfers_token_block_idx ON transfers (token_address, block_number);
  CREATE INDEX transfers_from_idx ON transfers (from_address);
  CREATE INDEX transfers_to_idx ON transfers (to_address);
  CREATE INDEX transfers_block_idx ON transfers (block_number);

  CREATE TABLE sync_state (
    id TEXT PRIMARY KEY,
    last_synced_block BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE token_metadata_cache (
    address TEXT PRIMARY KEY,
    name TEXT,
    symbol TEXT,
    decimals INTEGER,
    total_supply_raw NUMERIC(78, 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

async function freshDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await client.exec(DDL);
  return db;
}

describe("indexer worker (real PGlite Postgres + real Robinhood Chain RPC)", () => {
  let db: Db;

  beforeEach(async () => {
    db = await freshDb();
  });

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
});
