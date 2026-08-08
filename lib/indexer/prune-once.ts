// Batch entrypoint for the transfer-pruning job — mirrors run-once.ts's role
// for the transfer sync. See prune.ts's pruneOldTransfers for the actual
// (tested) logic — this file is just the CLI wrapper.
//
// Usage (see .github/workflows/indexer-sync.yml for the scheduled version,
// run after the sync step and before the snapshot step):
//   DATABASE_URL=postgres://... npx tsx lib/indexer/prune-once.ts
import { db } from "./db";
import { pruneOldTransfers, RETENTION_BLOCKS } from "./prune";

const retentionBlocks = process.env.PRUNE_RETENTION_BLOCKS
  ? BigInt(process.env.PRUNE_RETENTION_BLOCKS)
  : RETENTION_BLOCKS;
const timeBudgetMs = process.env.PRUNE_TIME_BUDGET_MS ? Number(process.env.PRUNE_TIME_BUDGET_MS) : 3 * 60_000;

pruneOldTransfers(db(), retentionBlocks, { timeBudgetMs })
  .then((result) => {
    console.log(
      `[prune] cutoff block ${result.cutoffBlock?.toString() ?? "n/a"}: deleted ${result.rowsDeleted} row(s) across ${result.batches} batch(es).`,
    );
  })
  .catch((err) => {
    console.error("[prune] run-once failed:", err);
    process.exit(1);
  });
