// Verifies resolveBalancesHybrid against the REAL Supabase database
// (whatever's already snapshotted — no mocking) and REAL Robinhood Chain
// RPC. Requires DATABASE_URL (this repo's .env.local, or CI secrets) —
// skips cleanly if it isn't set, rather than failing the whole suite for
// contributors without a configured database. Deliberately read-only
// against production data except for the auto-tracking side effect, which
// is itself part of the function's real contract, not a test artifact.
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { batchBalanceOf } from "@/lib/scan/rpc.server";
import { resolveBalancesHybrid } from "../hybrid-balances";
import { getHolderBalances } from "../queries";
import { trackedTokens } from "../schema";
import { db as getDb } from "../db";

const CASHCAT = "0x020bfC650A365f8BB26819deAAbF3E21291018b4"; // real token this app has scanned before
const UNTRACKED_PLACEHOLDER = "0x0000000000000000000000000000000000000002"; // extremely unlikely to have a snapshot

const hasDb = Boolean(process.env.DATABASE_URL);
const maybeDescribe = hasDb ? describe : describe.skip;

maybeDescribe("resolveBalancesHybrid (real Supabase DB + real RPC)", () => {
  it("falls back to rpc-only for a token with no balance snapshot, matching a direct batchBalanceOf call, and auto-tracks it", async () => {
    // All-lowercase — viem's getAddress only enforces EIP-55 checksum
    // matching when an address has mixed case; all-lowercase bypasses that
    // check entirely, so these are valid regardless of their real checksum.
    const candidates = ["0x000000000000000000000000000000000000dead", "0x000000000000000000000000000000000000beef"];

    const direct = await batchBalanceOf(UNTRACKED_PLACEHOLDER, candidates);
    const hybrid = await resolveBalancesHybrid(UNTRACKED_PLACEHOLDER, candidates);

    console.log("Direct:", Array.from(direct.balances.entries()), "Hybrid source:", hybrid.source);
    expect(hybrid.source === "rpc-only" || hybrid.source === "db+rpc-partial").toBe(true);
    for (const [addr, bal] of direct.balances) {
      expect(hybrid.balances.get(addr)).toBe(bal);
    }

    // The auto-track side effect: this token should now be registered for
    // the background snapshot job to pick up, even though this scan
    // resolved everything live. Best-effort in the real function (fire and
    // forget) — a short wait gives it a chance to land before checking.
    await new Promise((r) => setTimeout(r, 500));
    const rows = await getDb()
      .select()
      .from(trackedTokens)
      .where(eq(trackedTokens.tokenAddress, UNTRACKED_PLACEHOLDER.toLowerCase()));
    console.log("Tracked rows for placeholder token:", rows);
    expect(rows.length).toBe(1);
  }, 60_000);

  it("if CASHCAT has a real balance snapshot, resolveBalancesHybrid reads it from the DB and matches exactly what's stored", async () => {
    const stored = await getHolderBalances(getDb(), CASHCAT);
    if (stored.size === 0) {
      console.log("No balance snapshot exists yet for CASHCAT in this environment — skipping, nothing to compare.");
      return;
    }
    const candidates = Array.from(stored.keys()).slice(0, 5);
    const hybrid = await resolveBalancesHybrid(CASHCAT, candidates);
    console.log(`CASHCAT — ${candidates.length} candidates, source: ${hybrid.source}`);

    expect(hybrid.source === "db" || hybrid.source === "db+rpc-partial").toBe(true);
    for (const addr of candidates) {
      // Compared against what's actually stored (not a fresh live call) —
      // a DB-sourced balance is only guaranteed to match its own snapshot,
      // not necessarily the current instant, by design.
      expect(hybrid.balances.get(addr)).toBe(stored.get(addr));
    }
  }, 60_000);

  it("a mix of snapshotted and unsnapshotted candidates produces db+rpc-partial with each half resolved correctly", async () => {
    const stored = await getHolderBalances(getDb(), CASHCAT);
    if (stored.size === 0) {
      console.log("No balance snapshot exists yet for CASHCAT in this environment — skipping, nothing to compare.");
      return;
    }
    const knownWallet = Array.from(stored.keys())[0];
    const extraWallet = "0x0000000000000000000000000000000000cafe"; // not in any snapshot

    const hybrid = await resolveBalancesHybrid(CASHCAT, [knownWallet, extraWallet]);
    console.log("Mixed-candidate result:", hybrid.source, Array.from(hybrid.balances.entries()));
    expect(hybrid.source).toBe("db+rpc-partial");
    expect(hybrid.balances.get(knownWallet)).toBe(stored.get(knownWallet));

    const direct = await batchBalanceOf(CASHCAT, [extraWallet]);
    if (direct.balances.has(extraWallet)) {
      expect(hybrid.balances.get(extraWallet)).toBe(direct.balances.get(extraWallet));
    }
  }, 60_000);
});
