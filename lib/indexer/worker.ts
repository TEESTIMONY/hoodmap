// Ingest worker — the piece that runs OUTSIDE the Next.js request path,
// continuously, on a separate always-on process (not a Vercel function).
// Pulls Transfer events chain-wide from Robinhood Chain's RPC and writes
// them into Postgres, so the app's scan endpoints can eventually query a
// database instead of re-deriving everything live on every request.
//
// Reuses the same resilient pattern already proven in rpc.server.ts
// (fetchTransferLogs / fetchWalletTransferLogs): halve the range and retry
// once on failure, rather than giving up on a whole chunk. That code isn't
// duplicated here byte-for-byte because this worker's failure handling
// needs to be unbounded-retry (nothing is waiting on a request timeout),
// where the request-path version deliberately gives up after one retry.
//
// `db` is injected (not imported directly) specifically so this can be
// exercised in tests against PGlite (a real Postgres engine, in-process,
// no external service needed) instead of requiring a live database to
// exist before this code can be verified at all.
import { parseAbiItem, type Log } from "viem";
import { eq } from "drizzle-orm";
import type { Db } from "./db";
import { transfers, syncState, walletFunders } from "./schema";
import { publicClient, getLatestBlockNumber, ZERO_ADDRESS } from "@/lib/scan/rpc.server";

const TRANSFER_EVENT = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

// Small chunk size deliberately — discover.server.ts already established
// that an UNFILTERED getLogs (every contract, not one token) returns far
// more data per block than a single-token query, and needed a much
// tighter chunk (50 blocks) than the single-token scanner (900+) for
// exactly that reason. This worker does the same unfiltered scan, just
// continuously instead of over an 800-block window — starting from that
// same proven-safe order of magnitude rather than assuming a bigger
// number is fine without measuring it.
export const CHUNK_BLOCKS = 50n;

// Blocks held back from "latest" before ingesting, so a shallow reorg at
// the chain tip can't leave a permanently-wrong row in a table with no
// reconciliation logic yet. Small chunks + this lag together are the
// entire reorg strategy for now — reasonable for a first version, worth
// revisiting before this is the sole source of truth for anything.
export const SAFETY_LAG_BLOCKS = 3n;

const SYNC_STATE_ID = "global";

async function getLastSyncedBlock(db: Db, startBlock: bigint): Promise<bigint> {
  const rows = await db.select().from(syncState).where(eq(syncState.id, SYNC_STATE_ID));
  return rows[0]?.lastSyncedBlock ?? startBlock - 1n; // so the first sync starts at startBlock
}

async function setLastSyncedBlock(db: Db, block: bigint): Promise<void> {
  await db
    .insert(syncState)
    .values({ id: SYNC_STATE_ID, lastSyncedBlock: block })
    .onConflictDoUpdate({
      target: syncState.id,
      set: { lastSyncedBlock: block, updatedAt: new Date() },
    });
}

async function fetchLogsWithRetry(start: bigint, end: bigint): Promise<Log[]> {
  try {
    return await publicClient.getLogs({ event: TRANSFER_EVENT, fromBlock: start, toBlock: end });
  } catch {
    if (end > start) {
      const mid = start + (end - start) / 2n;
      const [a, b] = await Promise.all([
        fetchLogsWithRetry(start, mid),
        fetchLogsWithRetry(mid + 1n, end),
      ]);
      return [...a, ...b];
    }
    // Single-block chunk still failing — give up on just this one block
    // rather than retrying forever; the next full pass over this range
    // (this worker never marks a block "done" until it's successfully
    // ingested) will pick it up.
    return [];
  }
}

export interface SyncResult {
  synced: boolean;
  fromBlock: bigint;
  toBlock: bigint;
  rowsInserted: number;
}

export async function runSyncOnce(db: Db, startBlock: bigint): Promise<SyncResult> {
  const latest = await getLatestBlockNumber();
  const safeLatest = latest > SAFETY_LAG_BLOCKS ? latest - SAFETY_LAG_BLOCKS : 0n;
  const lastSynced = await getLastSyncedBlock(db, startBlock);
  const fromBlock = lastSynced + 1n;

  if (fromBlock > safeLatest) {
    return { synced: false, fromBlock, toBlock: safeLatest, rowsInserted: 0 };
  }

  const toBlock = fromBlock + CHUNK_BLOCKS - 1n > safeLatest ? safeLatest : fromBlock + CHUNK_BLOCKS - 1n;
  const logs = await fetchLogsWithRetry(fromBlock, toBlock);

  const rows = logs
    .map((l) => {
      const args = (l as Log & { args?: { from?: string; to?: string; value?: bigint } }).args;
      if (!args?.from || !args?.to || args.value == null || !l.transactionHash) return null;
      return {
        tokenAddress: l.address.toLowerCase(),
        fromAddress: args.from.toLowerCase(),
        toAddress: args.to.toLowerCase(),
        valueRaw: args.value.toString(),
        blockNumber: l.blockNumber ?? 0n,
        txHash: l.transactionHash,
        logIndex: l.logIndex ?? 0,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length > 0) {
    // onConflictDoNothing against the (txHash, logIndex) unique index is
    // what makes this safe to re-run — a restarted worker, an overlapping
    // chunk boundary, or a retried batch all just no-op on rows that
    // already made it in, rather than erroring or duplicating.
    await db.insert(transfers).values(rows).onConflictDoNothing();
    await recordFirstFunders(db, rows);
  }

  await setLastSyncedBlock(db, toBlock);
  return { synced: true, fromBlock, toBlock, rowsInserted: rows.length };
}

type TransferRow = {
  tokenAddress: string;
  fromAddress: string;
  toAddress: string;
  blockNumber: bigint;
  logIndex: number;
};

// Maintains wallet_funders incrementally: for every (token, wallet) this
// batch is the FIRST time we've ever seen a wallet receive that token, the
// sender becomes that wallet's recorded funder. A mint (from the zero
// address) doesn't count as a funding relationship — matches
// analyze.server.ts's live detectWalletClusters, which excludes it the
// same way.
async function recordFirstFunders(db: Db, rows: TransferRow[]): Promise<void> {
  // Ascending (block, logIndex) so that when the SAME (token, wallet) pair
  // receives multiple transfers within this one batch, the candidate kept
  // is genuinely the earliest — not whatever order the RPC/concatenated
  // halved-retry chunks happened to return.
  const sorted = [...rows].sort((a, b) =>
    a.blockNumber !== b.blockNumber ? (a.blockNumber < b.blockNumber ? -1 : 1) : a.logIndex - b.logIndex,
  );

  const seenInBatch = new Set<string>();
  const candidates: { tokenAddress: string; walletAddress: string; funderAddress: string; firstFundedBlock: bigint }[] =
    [];
  for (const r of sorted) {
    if (r.fromAddress === ZERO_ADDRESS) continue;
    const key = `${r.tokenAddress}:${r.toAddress}`;
    if (seenInBatch.has(key)) continue;
    seenInBatch.add(key);
    candidates.push({
      tokenAddress: r.tokenAddress,
      walletAddress: r.toAddress,
      funderAddress: r.fromAddress,
      firstFundedBlock: r.blockNumber,
    });
  }
  if (candidates.length === 0) return;

  // ON CONFLICT DO NOTHING against the (token, wallet) primary key is what
  // makes "first funder ever" correct across batches, not just within one:
  // if an earlier chunk already recorded this wallet's funder, this
  // no-ops rather than overwriting it with a later (wrong) sender.
  await db.insert(walletFunders).values(candidates).onConflictDoNothing();
}

export async function runForever(
  db: Db,
  startBlock: bigint,
  opts: { pollIntervalMs?: number; onProgress?: (r: SyncResult) => void } = {},
): Promise<never> {
  const pollIntervalMs = opts.pollIntervalMs ?? 3_000;
  for (;;) {
    try {
      const result = await runSyncOnce(db, startBlock);
      opts.onProgress?.(result);
      if (!result.synced) {
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }
    } catch (err) {
      console.error("[indexer] sync error, retrying after backoff:", err);
      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }
  }
}

export interface RunOnceResult {
  chunksProcessed: number;
  rowsInserted: number;
  finalBlock: bigint | null;
  caughtUp: boolean;
}

// Batch variant of runForever — loops through chunks until either fully
// caught up to the chain tip or `timeBudgetMs` is spent, then returns.
// This is what a scheduled job (GitHub Actions cron, etc.) uses instead of
// an always-on loop: same idempotent, resumable ingestion underneath, just
// bounded to fit inside one invocation instead of running forever.
export async function runUntilCaughtUpOrBudget(
  db: Db,
  startBlock: bigint,
  timeBudgetMs: number,
  opts: { onProgress?: (r: SyncResult) => void } = {},
): Promise<RunOnceResult> {
  const start = Date.now();
  let chunksProcessed = 0;
  let rowsInserted = 0;
  let finalBlock: bigint | null = null;
  let caughtUp = false;

  while (Date.now() - start < timeBudgetMs) {
    const result = await runSyncOnce(db, startBlock);
    opts.onProgress?.(result);
    if (!result.synced) {
      caughtUp = true;
      break;
    }
    chunksProcessed++;
    rowsInserted += result.rowsInserted;
    finalBlock = result.toBlock;
  }

  return { chunksProcessed, rowsInserted, finalBlock, caughtUp };
}

// Convenience helper to inspect current progress without running a sync —
// used by the serving side to know how fresh/complete the data is.
export async function getSyncStatus(db: Db): Promise<{ lastSyncedBlock: bigint | null; updatedAt: Date | null }> {
  const rows = await db.select().from(syncState).where(eq(syncState.id, SYNC_STATE_ID));
  return { lastSyncedBlock: rows[0]?.lastSyncedBlock ?? null, updatedAt: rows[0]?.updatedAt ?? null };
}
