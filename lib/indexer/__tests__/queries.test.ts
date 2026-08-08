// Verifies the read-side query layer against REAL ingested chain data —
// runs the actual worker sync against real Robinhood Chain RPC into a
// PGlite instance, then checks each query function's output against a
// hand-computed answer derived independently from the same raw rows. This
// catches "the query runs without erroring but returns the wrong thing,"
// which a query that merely doesn't throw would not.
import { describe, it, expect, beforeAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../schema";
import { runSyncOnce, CHUNK_BLOCKS } from "../worker";
import { getTokenTransfers, getWalletTransfers, getTrendingTokens } from "../queries";
import { getLatestBlockNumber } from "@/lib/scan/rpc.server";
import type { Db } from "../db";

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

describe("indexer query layer (real ingested chain data, cross-checked by hand)", () => {
  let db: Db;
  let allRows: (typeof schema.transfers.$inferSelect)[];
  let startBlock: bigint;

  beforeAll(async () => {
    const client = new PGlite();
    db = drizzle(client, { schema }) as unknown as Db;
    await client.exec(DDL);

    const latest = await getLatestBlockNumber();
    // Ingest 3 real chunks (150 blocks) so there's enough data for the
    // queries to have something meaningful to differentiate between.
    startBlock = latest - CHUNK_BLOCKS * 3n - 5n;
    for (let i = 0; i < 3; i++) {
      await runSyncOnce(db, startBlock);
    }

    allRows = await db.select().from(schema.transfers);
    console.log(`Ingested ${allRows.length} real transfers across 3 chunks for query verification.`);
    expect(allRows.length).toBeGreaterThan(0);
  }, 60_000);

  it("getTokenTransfers returns exactly the rows for one token, matching a hand count", async () => {
    // Pick whichever token has the most rows in the real ingested set —
    // guarantees a non-trivial sample without hardcoding an address that
    // might not appear in this particular live window.
    const counts = new Map<string, number>();
    for (const r of allRows) counts.set(r.tokenAddress, (counts.get(r.tokenAddress) ?? 0) + 1);
    const [busiestToken, expectedCount] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
    console.log(`Busiest token in this sample: ${busiestToken} (${expectedCount} transfers)`);

    const rows = await getTokenTransfers(db, busiestToken);
    console.log(`getTokenTransfers returned ${rows.length} rows`);
    expect(rows.length).toBe(expectedCount);
  });

  it("getWalletTransfers returns exactly the rows involving one real wallet, matching a hand count", async () => {
    const counts = new Map<string, number>();
    for (const r of allRows) {
      counts.set(r.fromAddress, (counts.get(r.fromAddress) ?? 0) + 1);
      counts.set(r.toAddress, (counts.get(r.toAddress) ?? 0) + 1);
    }
    const [busiestWallet, expectedCount] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
    console.log(`Busiest wallet in this sample: ${busiestWallet} (${expectedCount} legs)`);

    const rows = await getWalletTransfers(db, busiestWallet);
    console.log(`getWalletTransfers returned ${rows.length} rows`);
    expect(rows.length).toBe(expectedCount);
    for (const r of rows) {
      expect(r.fromAddress === busiestWallet || r.toAddress === busiestWallet).toBe(true);
    }
  });

  it("getTrendingTokens ranks tokens by unique-trader count, matching a hand computation", async () => {
    const tradersByToken = new Map<string, Set<string>>();
    const transferCountByToken = new Map<string, number>();
    for (const r of allRows) {
      const set = tradersByToken.get(r.tokenAddress) ?? new Set<string>();
      set.add(r.fromAddress);
      set.add(r.toAddress);
      tradersByToken.set(r.tokenAddress, set);
      transferCountByToken.set(r.tokenAddress, (transferCountByToken.get(r.tokenAddress) ?? 0) + 1);
    }
    // Same tie-break as the SQL query itself (unique traders, then transfer
    // count, then address ascending) — without matching it exactly, a real
    // tie makes this comparison flaky depending on which real chain data
    // happened to be ingested for this run. Confirmed live: this exact
    // scenario occurred in a real test run before the tie-break was added.
    const expectedTop = Array.from(tradersByToken.entries())
      .map(([addr, set]) => [addr, set.size, transferCountByToken.get(addr) ?? 0] as const)
      .sort((a, b) => b[1] - a[1] || b[2] - a[2] || a[0].localeCompare(b[0]))[0];
    console.log(`Hand-computed top token by unique traders: ${expectedTop[0]} (${expectedTop[1]} traders)`);

    const rows = await getTrendingTokens(db, startBlock, 10);
    console.log(
      "getTrendingTokens result:",
      rows.map((r) => `${r.tokenAddress}: ${r.uniqueTraders} traders, ${r.transferCount} transfers`),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].tokenAddress).toBe(expectedTop[0]);
    expect(rows[0].uniqueTraders).toBe(expectedTop[1]);
  });
});
