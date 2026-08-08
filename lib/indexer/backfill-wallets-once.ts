// Batch entrypoint for the wallet-backfill job — mirrors run-once.ts's role
// for the transfer sync. See wallet-backfill.ts's backfillTrackedWallets for
// the actual (tested) logic — this file is just the CLI wrapper.
//
// Safe to run on any cadence: progress per wallet is durable in
// tracked_wallets.backfill_cursor_block, so a run that doesn't finish a
// wallet's backfill just continues it next cycle, and a run that finds
// nothing pending (everything tracked is already fully backfilled) is a
// harmless no-op.
//
// Usage (see .github/workflows/indexer-sync.yml for the scheduled version):
//   DATABASE_URL=postgres://... npx tsx lib/indexer/backfill-wallets-once.ts
import { db } from "./db";
import { backfillTrackedWallets } from "./wallet-backfill";

const timeBudgetMs = process.env.WALLET_BACKFILL_TIME_BUDGET_MS
  ? Number(process.env.WALLET_BACKFILL_TIME_BUDGET_MS)
  : 3 * 60_000;

backfillTrackedWallets(db(), timeBudgetMs)
  .then((result) => {
    console.log(
      `[wallet-backfill] run-once complete: ${result.windowsProcessed} window(s) processed, ` +
        `${result.rowsInserted} row(s) inserted, ${result.walletsCompleted} wallet(s) reached genesis.`,
    );
  })
  .catch((err) => {
    console.error("[wallet-backfill] run-once failed:", err);
    process.exit(1);
  });
