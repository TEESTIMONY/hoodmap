// The "backward" half of full wallet history (see trackedWallets/
// walletTransfers in schema.ts). worker.ts's recordWalletActivity captures
// everything from trackedFromBlock onward for free, riding on the
// chain-wide ingest loop it's already running — but a wallet's real history
// almost always starts before it was tracked, and that part needs its own
// fetch: walking backward from trackedFromBlock toward genesis using
// fetchWalletTransferLogs (the same topic-filtered scan the live wallet
// passport already uses, just without that scan's 1,500,000-block safety
// cap — this runs as a background job with its own time budget, not inside
// a request, so the cap that exists specifically to avoid a serverless
// timeout doesn't apply here).
//
// Time-budgeted and resumable, same shape as prune/snapshot: each call
// processes as many backward windows as fit in the budget, persisting
// progress (backfillCursorBlock) after every window so a run that doesn't
// finish a wallet just continues it next cycle rather than losing progress
// or restarting from trackedFromBlock.
import { eq } from "drizzle-orm";
import type { Db } from "./db";
import { trackedWallets, walletTransfers } from "./schema";
import { fetchWalletTransferLogs } from "@/lib/scan/rpc.server";

// Size of one backward step. Deliberately smaller than the live wallet
// scanner's 500,000/1,500,000-block tiers — this runs many times over a
// wallet's full history across many cron cycles, so a smaller, safer,
// resumable step matters more here than finishing in as few calls as
// possible the way the request-path scanner needs to.
const BACKFILL_WINDOW_BLOCKS = 250_000n;
// Generous per-window cap for most wallets — fetchWalletTransferLogs
// itself already established (see its own comment) that a public RPC
// pushes back hard on request volume, so windows are additionally bisected
// (below) rather than raising this cap to "cover everything in one call."
const WINDOW_MAX_LOGS = 5_000;
// Bisection floor — below this, accept whatever came back rather than
// bisecting forever. A wallet with genuinely more than 5,000 relevant
// transfers in a single 1,000-block window is not a realistic case on a
// ~2s-block-time chain; this floor exists to guarantee termination, not
// because it's expected to be hit.
const MIN_WINDOW_BLOCKS = 1_000n;

export interface WalletBackfillResult {
  walletsCompleted: number;
  windowsProcessed: number;
  rowsInserted: number;
}

interface WindowOutcome {
  rowsInserted: number;
  // Any sub-range where fetchWalletTransferLogs' own internal retry still
  // failed — that block range's real transfers (if any) may be missing
  // from what got stored, NOT the same thing as "genuinely empty." Must
  // block the caller from advancing the cursor past this window or
  // marking it covered; a "complete" history that silently skipped a
  // failed fetch is exactly the kind of wrong-but-plausible-looking result
  // this codebase has repeatedly avoided elsewhere (batchBalanceOf,
  // metadata reads, etc.) — same discipline applies here.
  hadFailures: boolean;
}

async function backfillWindow(
  db: Db,
  wallet: string,
  windowStart: bigint,
  windowEnd: bigint,
): Promise<WindowOutcome> {
  let rowsInserted = 0;
  let hadFailures = false;
  // Walk this window in bisected sub-ranges whenever a sub-range turns out
  // too dense for WINDOW_MAX_LOGS — guarantees the whole
  // [windowStart, windowEnd] range is genuinely covered rather than
  // silently accepting a truncated, incomplete result for an active
  // wallet. Same "halve and retry" shape as the chain-wide worker's own
  // chunk-fetch retry.
  const stack: [bigint, bigint][] = [[windowStart, windowEnd]];
  while (stack.length > 0) {
    const [s, e] = stack.pop()!;
    const result = await fetchWalletTransferLogs(wallet, s, e, WINDOW_MAX_LOGS);
    if (result.truncated && e - s > MIN_WINDOW_BLOCKS) {
      const mid = s + (e - s) / 2n;
      stack.push([mid + 1n, e]);
      stack.push([s, mid]);
      continue;
    }
    if (result.failedFetches > 0) hadFailures = true;
    if (result.transfers.length > 0) {
      const legs = result.transfers.map((t) => ({
        walletAddress: wallet,
        tokenAddress: t.token.toLowerCase(),
        counterparty: (t.from.toLowerCase() === wallet ? t.to : t.from).toLowerCase(),
        direction: (t.from.toLowerCase() === wallet ? "out" : "in") as "in" | "out",
        valueRaw: t.valueRaw.toString(),
        blockNumber: t.blockNumber,
        txHash: t.txHash,
        logIndex: t.logIndex,
      }));
      // ON CONFLICT DO NOTHING against (walletAddress, txHash, logIndex) —
      // safe against overlap with whatever recordWalletActivity has
      // already captured forward of this wallet's trackedFromBlock, and
      // safe to re-run this same window (including a partially-failed one
      // retried next cycle) since re-fetching a block range that already
      // partially landed just no-ops on what's already there.
      await db.insert(walletTransfers).values(legs).onConflictDoNothing();
      rowsInserted += legs.length;
    }
  }
  return { rowsInserted, hadFailures };
}

export async function backfillTrackedWallets(
  db: Db,
  timeBudgetMs: number,
): Promise<WalletBackfillResult> {
  const start = Date.now();
  let walletsCompleted = 0;
  let windowsProcessed = 0;
  let rowsInserted = 0;
  // A wallet whose window failed this run is skipped for the REST of this
  // run (not retried immediately) — without this, a wallet hitting
  // persistent RPC trouble would keep being picked as "oldest still
  // incomplete" every iteration and burn the whole time budget hammering
  // the same failing window, the exact request-volume pattern that
  // triggered a real rate-limit incident elsewhere in this indexer. The
  // next scheduled run (15 min later) retries it fresh.
  const skipThisRun = new Set<string>();

  while (Date.now() - start < timeBudgetMs) {
    // Oldest-tracked-first, not unspecified DB order — a wallet someone
    // looked up first shouldn't wait behind one tracked a moment ago. Works
    // one wallet to completion before the next pending one gets picked up
    // (this wallet keeps being the "oldest still incomplete" row across
    // iterations until its own backfillComplete flips true).
    const pending = await db
      .select()
      .from(trackedWallets)
      .where(eq(trackedWallets.backfillComplete, false))
      .orderBy(trackedWallets.firstTrackedAt)
      .limit(20);
    const w = pending.find((row) => !skipThisRun.has(row.walletAddress));
    if (!w) break; // everything tracked is either fully backfilled or already failed this run

    const cursor = w.backfillCursorBlock ?? w.trackedFromBlock;
    if (cursor <= 0n) {
      await db
        .update(trackedWallets)
        .set({ backfillComplete: true })
        .where(eq(trackedWallets.walletAddress, w.walletAddress));
      walletsCompleted++;
      continue;
    }

    const windowEnd = cursor - 1n; // walking backward; the cursor block itself is already covered
    const windowStart = windowEnd > BACKFILL_WINDOW_BLOCKS ? windowEnd - BACKFILL_WINDOW_BLOCKS + 1n : 0n;

    let outcome: WindowOutcome;
    try {
      outcome = await backfillWindow(db, w.walletAddress, windowStart, windowEnd);
    } catch {
      // fetchWalletTransferLogs doesn't normally throw (it catches its own
      // per-chunk RPC failures), so this is an unexpected failure (DB
      // hiccup, etc.) — same resilience as runUntilCaughtUpOrBudget: don't
      // let one wallet's failure crash the whole batch, skip it for the
      // rest of this run and let the next scheduled run retry.
      skipThisRun.add(w.walletAddress);
      continue;
    }
    rowsInserted += outcome.rowsInserted;
    windowsProcessed++;

    if (outcome.hadFailures) {
      // Whatever this window did return is already stored (safe, real
      // data) — but the cursor must NOT move past a window that might
      // still have missing transfers in it. Leave it exactly where it is
      // so the same window gets retried next run instead of being
      // silently treated as fully covered.
      skipThisRun.add(w.walletAddress);
      continue;
    }

    const reachedGenesis = windowStart === 0n;
    await db
      .update(trackedWallets)
      .set({ backfillCursorBlock: windowStart, backfillComplete: reachedGenesis })
      .where(eq(trackedWallets.walletAddress, w.walletAddress));
    if (reachedGenesis) walletsCompleted++;
  }

  return { walletsCompleted, windowsProcessed, rowsInserted };
}
