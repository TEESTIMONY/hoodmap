// Shared test-only Postgres setup — PGlite (real Postgres compiled to
// WASM, running in-process) so indexer tests can run against real
// Postgres semantics without needing an external database to exist.
//
// DDL is applied directly rather than via drizzle-kit's migration files
// (those target a real Postgres server, not available in this test
// environment) — kept in exactly ONE place specifically because this used
// to be duplicated across worker.test.ts and queries.test.ts, which is
// exactly the kind of thing that silently drifts out of sync with
// schema.ts when a table changes and only one copy gets updated.
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "../schema";
import type { Db } from "../db";

export const TEST_DDL = `
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

  CREATE TABLE wallet_funders (
    token_address TEXT NOT NULL,
    wallet_address TEXT NOT NULL,
    funder_address TEXT NOT NULL,
    first_funded_block BIGINT NOT NULL,
    inserted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (token_address, wallet_address)
  );
  CREATE INDEX wallet_funders_token_funder_idx ON wallet_funders (token_address, funder_address);
`;

export async function freshTestDb(): Promise<Db> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await client.exec(TEST_DDL);
  return db;
}
