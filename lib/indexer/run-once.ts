// Batch entrypoint for the ingest worker — for a scheduled job (GitHub
// Actions cron, etc.) instead of an always-on process. See
// worker.ts's runUntilCaughtUpOrBudget for the actual (tested) logic —
// this file is just the CLI wrapper: read env config, call it, log
// results, exit.
//
// Safe to run on any cadence: progress is durable in sync_state, so a run
// that gets caught up simply has nothing to do next time, and a run that
// doesn't finish catching up just leaves more for the following
// invocation to pick up — never loses or duplicates work either way.
//
// Usage (see .github/workflows/indexer-sync.yml for the scheduled version):
//   DATABASE_URL=postgres://... npx tsx lib/indexer/run-once.ts
import { db } from "./db";
import { runUntilCaughtUpOrBudget } from "./worker";

const startBlock = process.env.INDEXER_START_BLOCK ? BigInt(process.env.INDEXER_START_BLOCK) : 0n;
// Leave real headroom before whatever the job runner's own timeout is
// (GitHub Actions' default job timeout is 6 hours, but a cron-triggered
// sync job should finish well inside its own scheduling interval, not
// anywhere near that) — this stops proactively rather than relying on an
// external kill.
const timeBudgetMs = process.env.INDEXER_TIME_BUDGET_MS ? Number(process.env.INDEXER_TIME_BUDGET_MS) : 4 * 60_000;

runUntilCaughtUpOrBudget(db(), startBlock, timeBudgetMs, {
  onProgress: (r) => {
    if (r.synced) console.log(`[indexer] blocks ${r.fromBlock}-${r.toBlock}: ${r.rowsInserted} rows`);
  },
})
  .then((result) => {
    console.log(
      `[indexer] run-once complete: ${result.chunksProcessed} chunk(s), ${result.rowsInserted} row(s) inserted` +
        (result.finalBlock != null ? `, ended at block ${result.finalBlock}` : "") +
        (result.caughtUp ? " (caught up to chain tip)" : " (time budget reached, more work remains)"),
    );
  })
  .catch((err) => {
    console.error("[indexer] run-once failed:", err);
    process.exit(1);
  });
