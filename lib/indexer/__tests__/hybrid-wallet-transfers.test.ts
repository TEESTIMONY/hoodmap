// Verifies resolveWalletTransfersHybrid against the REAL Supabase database
// (whatever's already tracked/backfilled — no mocking) and REAL Robinhood
// Chain RPC. Requires DATABASE_URL — skips cleanly if it isn't set, same
// pattern as hybrid-balances.test.ts.
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { resolveWalletTransfersHybrid } from "../hybrid-wallet-transfers";
import { trackedWallets } from "../schema";
import { db as getDb } from "../db";

// Extremely unlikely to have been looked up by anyone before this test —
// avoids colliding with real production tracking state.
const FRESH_PLACEHOLDER = "0x000000000000000000000000000000000000f00d";

const hasDb = Boolean(process.env.DATABASE_URL);
const maybeDescribe = hasDb ? describe : describe.skip;

maybeDescribe("resolveWalletTransfersHybrid (real Supabase DB + real RPC)", () => {
  it("a never-before-seen wallet gets auto-tracked and returns a valid (near-empty) db-partial result", async () => {
    const result = await resolveWalletTransfersHybrid(FRESH_PLACEHOLDER);
    console.log("Fresh wallet result:", {
      source: result.source,
      dbCoverageFromBlock: result.dbCoverageFromBlock?.toString(),
      transferCount: result.transfers.length,
    });

    expect(result.source === "db-partial" || result.source === "rpc-only").toBe(true);

    const rows = await getDb()
      .select()
      .from(trackedWallets)
      .where(eq(trackedWallets.walletAddress, FRESH_PLACEHOLDER.toLowerCase()));
    console.log("Tracked row for placeholder wallet:", rows);
    expect(rows.length).toBe(1);
    expect(rows[0].backfillComplete).toBe(false);
  }, 60_000);

  it("calling it twice in a row is idempotent — second call sees the same tracked row, not a duplicate", async () => {
    await resolveWalletTransfersHybrid(FRESH_PLACEHOLDER);
    const result2 = await resolveWalletTransfersHybrid(FRESH_PLACEHOLDER);
    console.log("Second call result:", result2.source);

    const rows = await getDb()
      .select()
      .from(trackedWallets)
      .where(eq(trackedWallets.walletAddress, FRESH_PLACEHOLDER.toLowerCase()));
    expect(rows.length).toBe(1); // still exactly one row, not duplicated
  }, 60_000);
});
