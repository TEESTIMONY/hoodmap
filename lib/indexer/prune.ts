// Bounds transfers table growth. The indexer scans every contract on the
// chain, unfiltered — that grows without limit, and it already exceeded a
// fixed-size Postgres plan's storage quota once (Supabase flipped the
// database read-only mid-sync: "cannot execute INSERT in a read-only
// transaction"). This deletes transfer rows older than a retention window,
// chunked to avoid one giant transaction, meant to run every cycle
// (alongside the sync/snapshot steps) so growth stays bounded instead of
// periodically spiking past quota again.
//
// Safe with respect to everything else this indexer maintains:
// wallet_funders and holder_balances are derived from transfers at
// write/snapshot time and persisted independently of the source rows —
// pruning old transfers does NOT un-derive an already-recorded funder
// relationship or balance snapshot. What DOES lose depth: getWalletTransfers
// (wallet PnL/history) and the balance-snapshot job's candidate-selection
// window, both of which only see whatever's left after pruning — a real
// trade-off, not a free win, made explicitly to stay under a storage quota.
import { sql, eq } from "drizzle-orm";
import { transfers, syncState } from "./schema";
import type { Db } from "./db";

// ~20 hours at ~2s/block. Chosen specifically because it's what actually
// reduces storage at current chain activity — measured live: a 2-day
// window only removed ~9% of existing rows (nearly all data was already
// inside 2 days; the chain's real activity ramped up and got backfilled
// within about a day). Adjust freely here if activity drops or the
// Supabase plan gets upgraded later — nothing else depends on this exact
// value.
export const RETENTION_BLOCKS = 36_000n;

const DELETE_BATCH_SIZE = 50_000;

export interface PruneResult {
  cutoffBlock: bigint | null;
  rowsDeleted: number;
  batches: number;
}

export async function pruneOldTransfers(
  db: Db,
  retentionBlocks: bigint = RETENTION_BLOCKS,
  opts: { timeBudgetMs?: number } = {},
): Promise<PruneResult> {
  const start = Date.now();
  const timeBudgetMs = opts.timeBudgetMs ?? 4 * 60_000;

  // Pruning relative to the indexer's own sync_state (not a fresh
  // getLatestBlockNumber RPC call) — this is what "how far the indexer has
  // gotten" actually means for this table, and avoids an extra RPC round
  // trip for a value already durable in the DB.
  const rows = await db.select().from(syncState).where(eq(syncState.id, "global"));
  const tip = rows[0]?.lastSyncedBlock;
  if (tip == null) {
    return { cutoffBlock: null, rowsDeleted: 0, batches: 0 };
  }
  const cutoff = tip > retentionBlocks ? tip - retentionBlocks : 0n;

  let rowsDeleted = 0;
  let batches = 0;
  for (;;) {
    if (Date.now() - start >= timeBudgetMs) break;
    // Batched via a subquery + LIMIT (not one unbounded DELETE) so a large
    // backlog doesn't hold a single long-running transaction/lock — same
    // reasoning as the ingest worker's own chunking. RETURNING id (rather
    // than trusting a driver-specific affected-row count) so the batch size
    // check works identically under postgres-js (production) and PGlite
    // (tests) — same normalization getTrendingTokens already needs for
    // exactly this reason.
    const result = await db.execute(sql`
      delete from ${transfers}
      where id in (
        select id from ${transfers} where block_number < ${cutoff} order by block_number asc limit ${DELETE_BATCH_SIZE}
      )
      returning id
    `);
    const deletedRows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
    batches++;
    rowsDeleted += deletedRows.length;
    if (deletedRows.length < DELETE_BATCH_SIZE) break; // fewer than a full batch = caught up
  }

  return { cutoffBlock: cutoff, rowsDeleted, batches };
}
