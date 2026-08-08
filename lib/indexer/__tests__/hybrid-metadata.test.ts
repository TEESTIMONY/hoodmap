// Verifies resolveMetadataHybrid against the REAL Supabase database and
// REAL Robinhood Chain RPC. Requires DATABASE_URL — skips cleanly if it
// isn't set. Assertions focus on VALUE correctness against a direct,
// independent readTokenMetadata call regardless of which source served the
// result (rpc or db) — robust to this test suite being run repeatedly
// against real, not fully test-controlled, production state.
import { describe, it, expect } from "vitest";
import { readTokenMetadata } from "@/lib/scan/rpc.server";
import { resolveMetadataHybrid } from "../hybrid-metadata";
import { getCachedTokenMetadata } from "../queries";
import { db as getDb } from "../db";

const CASHCAT = "0x020bfC650A365f8BB26819deAAbF3E21291018b4"; // real token this app has scanned before

const hasDb = Boolean(process.env.DATABASE_URL);
const maybeDescribe = hasDb ? describe : describe.skip;

maybeDescribe("resolveMetadataHybrid (real Supabase DB + real RPC)", () => {
  it("returns metadata matching a direct readTokenMetadata call, whichever source served it, and leaves the cache populated afterward", async () => {
    const direct = await readTokenMetadata(CASHCAT);
    const hybrid = await resolveMetadataHybrid(CASHCAT);

    console.log("Direct:", direct.name, direct.symbol, direct.decimals, direct.totalSupplyRaw.toString());
    console.log("Hybrid source:", hybrid.source, hybrid.meta.name, hybrid.meta.symbol, hybrid.meta.decimals);

    expect(hybrid.meta.name).toBe(direct.name);
    expect(hybrid.meta.symbol).toBe(direct.symbol);
    expect(hybrid.meta.decimals).toBe(direct.decimals);
    // totalSupply can differ by the time this second live call runs if a
    // mint/burn happens mid-test (rare, but a real possibility, not a
    // testing artifact) — decimals/name/symbol are the values that must be
    // exact; skip a brittle totalSupply equality check.

    // Write-through (source "rpc") or already-cached (source "db") — either
    // way, the cache should now hold a real, non-null row for this token.
    const cached = await getCachedTokenMetadata(getDb(), CASHCAT);
    expect(cached).not.toBeNull();
    expect(cached?.name).toBe(direct.name);
    expect(cached?.symbol).toBe(direct.symbol);
  }, 60_000);

  it("a second call reads from the now-populated cache (source db) with the same values as the first call", async () => {
    const first = await resolveMetadataHybrid(CASHCAT);
    const second = await resolveMetadataHybrid(CASHCAT);

    console.log("First source:", first.source, "Second source:", second.source);
    expect(second.source).toBe("db");
    expect(second.meta.name).toBe(first.meta.name);
    expect(second.meta.symbol).toBe(first.meta.symbol);
    expect(second.meta.decimals).toBe(first.meta.decimals);
  }, 60_000);
});
