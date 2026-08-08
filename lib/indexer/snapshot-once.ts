// Batch entrypoint for the balance-snapshot job — mirrors run-once.ts's role
// for the transfer sync, just for a different table. See snapshot.ts's
// runSnapshotUntilBudget for the actual (tested) logic — this file is just
// the CLI wrapper: read env config, call it, log results, exit.
//
// Safe to run on any cadence, same reasoning as run-once.ts: a token that
// doesn't get snapshotted this pass just stays "as fresh as its last
// snapshot" (or fully live, if it's never been snapshotted) until the next
// run picks it up — never wrong, only possibly stale.
//
// Usage (see .github/workflows/indexer-sync.yml for the scheduled version):
//   DATABASE_URL=postgres://... npx tsx lib/indexer/snapshot-once.ts
import { db } from "./db";
import { runSnapshotUntilBudget } from "./snapshot";

const timeBudgetMs = process.env.SNAPSHOT_TIME_BUDGET_MS
  ? Number(process.env.SNAPSHOT_TIME_BUDGET_MS)
  : 3 * 60_000;

runSnapshotUntilBudget(db(), timeBudgetMs, {
  onProgress: (r) => {
    console.log(`[snapshot] ${r.tokenAddress}: ${r.balancesResolved}/${r.candidateCount} balances resolved`);
  },
})
  .then((result) => {
    console.log(
      `[snapshot] run-once complete: ${result.tokensProcessed} token(s) snapshotted` +
        (result.tokensFailed > 0 ? `, ${result.tokensFailed} failed (will retry next run)` : ""),
    );
  })
  .catch((err) => {
    console.error("[snapshot] run-once failed:", err);
    process.exit(1);
  });
