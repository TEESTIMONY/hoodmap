// Verifies resolveWalletTransfersHybrid against the REAL Supabase database
// (whatever's already tracked/backfilled — no mocking), REAL Robinhood
// Chain RPC, and — now that Blockscout is tried first — the REAL
// Blockscout Pro API. Requires DATABASE_URL — skips cleanly if it isn't
// set, same pattern as hybrid-balances.test.ts.
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

maybeDescribe("resolveWalletTransfersHybrid (real Supabase DB + real RPC + real Blockscout)", () => {
  it("tries Blockscout first when configured and returns a valid result for a wallet with no real history", async () => {
    const result = await resolveWalletTransfersHybrid(FRESH_PLACEHOLDER);
    console.log("Fresh wallet result:", {
      source: result.source,
      dbCoverageFromBlock: result.dbCoverageFromBlock?.toString(),
      transferCount: result.transfers.length,
    });

    if (process.env.BLOCKSCOUT_API_KEY) {
      // Blockscout succeeding is the expected common case now — a wallet
      // with no real activity still gets a clean "full" result (pagination
      // just finds nothing), not an error.
      expect(result.source === "blockscout-full" || result.source === "blockscout-partial").toBe(true);
    } else {
      expect(result.source === "db-partial" || result.source === "rpc-only").toBe(true);
    }
  }, 60_000);

  it("falls back to the DB/live-RPC path (and tracks the wallet) when Blockscout isn't configured", async () => {
    const savedKey = process.env.BLOCKSCOUT_API_KEY;
    delete process.env.BLOCKSCOUT_API_KEY;
    try {
      const result = await resolveWalletTransfersHybrid(FRESH_PLACEHOLDER);
      console.log("DB-fallback result:", result.source);
      expect(result.source === "db-partial" || result.source === "rpc-only").toBe(true);

      // The DB-path side effect (auto-tracking for background backfill)
      // only runs on this path — Blockscout succeeding skips it entirely
      // (see resolveWalletTransfersHybrid: it returns before ever reaching
      // the DB branch), so this is only guaranteed here, not in the test
      // above.
      const rows = await getDb()
        .select()
        .from(trackedWallets)
        .where(eq(trackedWallets.walletAddress, FRESH_PLACEHOLDER.toLowerCase()));
      console.log("Tracked row for placeholder wallet:", rows);
      expect(rows.length).toBe(1);
    } finally {
      if (savedKey) process.env.BLOCKSCOUT_API_KEY = savedKey;
    }
  }, 60_000);

  it("calling it twice in a row is idempotent — second call doesn't duplicate the tracked row", async () => {
    const savedKey = process.env.BLOCKSCOUT_API_KEY;
    delete process.env.BLOCKSCOUT_API_KEY;
    try {
      await resolveWalletTransfersHybrid(FRESH_PLACEHOLDER);
      const result2 = await resolveWalletTransfersHybrid(FRESH_PLACEHOLDER);
      console.log("Second call result:", result2.source);

      const rows = await getDb()
        .select()
        .from(trackedWallets)
        .where(eq(trackedWallets.walletAddress, FRESH_PLACEHOLDER.toLowerCase()));
      expect(rows.length).toBe(1); // still exactly one row, not duplicated
    } finally {
      if (savedKey) process.env.BLOCKSCOUT_API_KEY = savedKey;
    }
    // Two real, live DB/RPC-path calls in sequence — measured 59.5s
    // standalone, uncomfortably close to a 60s limit; real headroom here
    // rather than a number already proven to be borderline.
  }, 120_000);
});
