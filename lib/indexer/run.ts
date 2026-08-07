// Standalone entrypoint for the ingest worker — run this on a separate
// always-on process (a small VPS, a Railway/Fly.io/Render worker service),
// NOT as a Vercel function. It runs forever, is safe to kill and restart
// at any point (progress is durable in sync_state, ingestion is
// idempotent), and does not serve any HTTP traffic itself.
//
// Usage:
//   DATABASE_URL=postgres://... npx tsx lib/indexer/run.ts
//
// START_BLOCK controls where backfill begins. Defaults to 0 (full chain
// history) — for Robinhood Chain at ~30M blocks with real activity
// concentrated recently, consider starting from a later block (e.g. the
// oldest block any currently-tracked token was deployed at) to reach "live
// and useful" much faster, then backfilling older history as a lower
// priority, separate pass. That's a product decision, not a technical one
// — this defaults to the complete-but-slower option.
import { db } from "./db";
import { runForever } from "./worker";

const startBlock = process.env.INDEXER_START_BLOCK ? BigInt(process.env.INDEXER_START_BLOCK) : 0n;

console.log(`[indexer] starting sync from block ${startBlock}`);

runForever(db(), startBlock, {
  onProgress: (r) => {
    if (r.synced) {
      console.log(`[indexer] blocks ${r.fromBlock}-${r.toBlock}: ${r.rowsInserted} transfers ingested`);
    }
  },
}).catch((err) => {
  console.error("[indexer] fatal error:", err);
  process.exit(1);
});
