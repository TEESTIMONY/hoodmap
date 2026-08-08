// Persistent chain-history schema — the piece the current architecture is
// missing entirely. Every request-path scan (analyze.server.ts,
// discover.server.ts, wallet-analyze.server.ts) re-derives everything live
// from RPC, bounded to a recent window, because there's nowhere to store
// what's already been read. This table is that store: once a transfer is
// ingested here, it's queryable instantly and forever, independent of how
// unreliable or slow the RPC is at query time.
import {
  pgTable,
  text,
  bigint,
  integer,
  timestamp,
  numeric,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/pg-core";

// One row per Transfer log, chain-wide (every ERC20 contract, not just
// tokens we already know about) — this is what lets discovery/trending
// become a DB query instead of a live 800-block RPC scan, and what lets a
// wallet's cross-token history become one query instead of the wallet
// scanner's own multi-tier RPC sweep.
export const transfers = pgTable(
  "transfers",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    tokenAddress: text("token_address").notNull(),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    // uint256 range (up to ~1.15e77) — NUMERIC(78,0) is the only Postgres
    // type that holds a raw ERC20 value without precision loss. Storing
    // the raw string, not a decimals-adjusted float — decimals-adjustment
    // is a display concern, done at query time like the rest of this app
    // already does via formatUnits().
    valueRaw: numeric("value_raw", { precision: 78, scale: 0 }).notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    // Nullable — populated by a separate, lower-priority backfill pass
    // (one eth_getBlock per unique block is its own cost, same reasoning
    // as batchBlockTimestamps in the current live scanner). Not needed for
    // the ingest loop's own correctness.
    blockTimestamp: timestamp("block_timestamp", { withTimezone: true }),
    insertedAt: timestamp("inserted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // A given log (identified by its transaction + position within it) is
    // globally unique — this is what makes re-running a chunk (retry,
    // overlap, worker restart) safe: INSERT ... ON CONFLICT DO NOTHING
    // against this index means ingestion is idempotent by construction,
    // not by careful bookkeeping.
    uniqueIndex("transfers_tx_log_idx").on(table.txHash, table.logIndex),
    // Answers "give me this token's transfer history" — the core query
    // behind single-token holder/cluster analysis.
    index("transfers_token_block_idx").on(table.tokenAddress, table.blockNumber),
    // Answers "give me this wallet's history" (both directions) — the core
    // query behind wallet PnL scanning.
    index("transfers_from_idx").on(table.fromAddress),
    index("transfers_to_idx").on(table.toAddress),
    // Answers "what happened recently, chain-wide" — the core query behind
    // trending/discovery.
    index("transfers_block_idx").on(table.blockNumber),
  ],
);

// Singleton progress tracker — how the worker knows where it left off
// across restarts, and how a serving-side query can tell a caller "data is
// current as of block N" instead of silently going stale.
export const syncState = pgTable("sync_state", {
  id: text("id").primaryKey(),
  lastSyncedBlock: bigint("last_synced_block", { mode: "bigint" }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Who funded whom, first — one row per (token, wallet) recording that
// wallet's FIRST observed inbound transfer of that specific token, and who
// sent it. This is what lets cluster detection ("co-funded" wallets) run
// against the database's full indexed history instead of the live
// scanner's capped MAX_TRANSFER_LOGS window — a wallet's first funder for
// a token, once observed, never changes, so this only ever needs writing
// once per (token, wallet), making it cheap to maintain incrementally as
// the ingest worker processes new transfers.
//
// Deliberately simple at write time: records the raw first-sender, with no
// attempt to classify it as a liquidity pool / router here (that
// classification needs aggregate in/out flow context the streaming
// per-transfer ingest doesn't have cheaply available). That filtering
// happens at query time instead (see getWalletFunderClusters), matching
// where analyze.server.ts's live detectWalletClusters already does it.
export const walletFunders = pgTable(
  "wallet_funders",
  {
    tokenAddress: text("token_address").notNull(),
    walletAddress: text("wallet_address").notNull(),
    funderAddress: text("funder_address").notNull(),
    firstFundedBlock: bigint("first_funded_block", { mode: "bigint" }).notNull(),
    insertedAt: timestamp("inserted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tokenAddress, table.walletAddress] }),
    // Answers "who did this funder fund" — the core query behind
    // full-history cluster detection (GROUP BY funder_address).
    index("wallet_funders_token_funder_idx").on(table.tokenAddress, table.funderAddress),
  ],
);

// Cached token metadata (name/symbol/decimals/totalSupply) — these never
// change post-deploy (decimals/name/symbol) or change rarely (totalSupply,
// on mint/burn), so there's no reason to re-read them via RPC on every
// query the way the live scanner currently does.
export const tokenMetadataCache = pgTable("token_metadata_cache", {
  address: text("address").primaryKey(),
  name: text("name"),
  symbol: text("symbol"),
  decimals: integer("decimals"),
  totalSupplyRaw: numeric("total_supply_raw", { precision: 78, scale: 0 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
