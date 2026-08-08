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
  boolean,
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
// against the database's retained history (see lib/indexer/prune.ts —
// bounded, not unbounded, to control storage) instead of the live
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

// Which tokens the background snapshot job should keep fresh. A token is
// added here the first time anyone scans it live (see
// lib/indexer/hybrid-balances.ts) — an explicit "someone cares about this
// token" signal, not every contract the chain-wide indexer has ever seen a
// transfer for (that would be nearly every token that's ever moved, most of
// which nobody is looking at — periodically re-resolving live balanceOf for
// all of them would be a large, mostly-wasted amount of RPC volume). One row
// per token; `lastSnapshotAt` stays null until the snapshot job's first pass
// over it completes, so a caller can tell "just registered, no snapshot yet"
// apart from "snapshotted a while ago."
export const trackedTokens = pgTable("tracked_tokens", {
  tokenAddress: text("token_address").primaryKey(),
  firstTrackedAt: timestamp("first_tracked_at", { withTimezone: true }).defaultNow().notNull(),
  lastSnapshotAt: timestamp("last_snapshot_at", { withTimezone: true }),
});

// Periodic live-balanceOf snapshots — NOT balances derived/summed from
// indexed transfer history (that has the partial-backfill correctness trap:
// a wallet's running balance is only right if we've seen its ENTIRE history,
// which isn't true yet). Every row here still came from a real balanceOf
// call against the chain; the only thing that changed is WHEN that call
// happened (on the snapshot job's schedule, not on every request that
// happens to need it) — so a stored value is exactly as correct as a live
// one was at the moment it was captured, just potentially stale by up to one
// snapshot cycle. See lib/indexer/snapshot.ts for the write side and
// lib/indexer/hybrid-balances.ts for how a scan reads (and gracefully falls
// back past) this.
export const holderBalances = pgTable(
  "holder_balances",
  {
    tokenAddress: text("token_address").notNull(),
    walletAddress: text("wallet_address").notNull(),
    balanceRaw: numeric("balance_raw", { precision: 78, scale: 0 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tokenAddress, table.walletAddress] }),
  ],
);

// Which wallets the wallet passport should keep a permanent activity log
// for. A wallet is added here the first time anyone looks it up (see
// lib/indexer/hybrid-wallet-transfers.ts) — same "someone cares about this"
// signal as trackedTokens, deliberately NOT every address that's ever
// touched a transfer (that's effectively every wallet on the chain, and
// would reproduce the exact unbounded-storage incident that made the bulk
// `transfers` table need pruning in the first place).
//
// trackedFromBlock anchors where incremental forward-capture (worker.ts,
// alongside recordFirstFunders) started — everything from that block
// onward is captured for free as the chain-wide ingest loop processes new
// transfers anyway. backfillCursorBlock is how far the separate backward
// backfill job (wallet-backfill.ts) has reached walking toward genesis;
// null means not started yet. backfillComplete flips true once the cursor
// reaches block 0 — at that point walletTransfers holds this wallet's
// entire history, forever, with no pruning (this is the one deliberate
// exception to this indexer's usual bounded-retention rule, made because
// growth here is bounded by "wallets someone actually looked up," not by
// chain-wide activity).
export const trackedWallets = pgTable("tracked_wallets", {
  walletAddress: text("wallet_address").primaryKey(),
  firstTrackedAt: timestamp("first_tracked_at", { withTimezone: true }).defaultNow().notNull(),
  trackedFromBlock: bigint("tracked_from_block", { mode: "bigint" }).notNull(),
  backfillCursorBlock: bigint("backfill_cursor_block", { mode: "bigint" }),
  backfillComplete: boolean("backfill_complete").default(false).notNull(),
});

// A tracked wallet's full cross-token transfer history — one row per
// (wallet, transfer-leg), never pruned by block age (unlike `transfers`).
// Populated two ways: worker.ts appends new activity as it's ingested
// chain-wide (cheap, already-flowing data, covers trackedFromBlock
// onward), and wallet-backfill.ts walks backward from trackedFromBlock to
// genesis in the background (see trackedWallets above) to fill in
// everything that happened before the wallet was tracked. Together these
// two give "this wallet's entire history since its first-ever activity,"
// which is what actually answers "full wallet history" — neither
// mechanism alone does.
//
// Stored per-wallet-perspective (walletAddress is "whose passport is
// this row for", counterparty is the other side) rather than reusing
// `transfers`' from/to shape directly, so a query for one wallet's
// passport never needs an OR-across-two-columns scan — same reasoning as
// wallet_funders being keyed the way callers actually query it.
export const walletTransfers = pgTable(
  "wallet_transfers",
  {
    walletAddress: text("wallet_address").notNull(),
    tokenAddress: text("token_address").notNull(),
    counterparty: text("counterparty").notNull(),
    direction: text("direction").notNull(), // 'in' | 'out'
    valueRaw: numeric("value_raw", { precision: 78, scale: 0 }).notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockTimestamp: timestamp("block_timestamp", { withTimezone: true }),
    insertedAt: timestamp("inserted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // A given log is relevant to a given wallet at most once — this is
    // what makes both the incremental writer and the backfill job safe to
    // re-run over overlapping ranges (ON CONFLICT DO NOTHING), same
    // idempotency pattern as `transfers`' own unique index.
    primaryKey({ columns: [table.walletAddress, table.txHash, table.logIndex] }),
    // Answers "give me this wallet's full history in order" — the core
    // query behind the wallet passport.
    index("wallet_transfers_wallet_block_idx").on(table.walletAddress, table.blockNumber),
  ],
);
