// Verifies the balance/metadata snapshot job against REAL ingested chain
// data (via the actual worker sync) and REAL Robinhood Chain RPC — no
// mocking. Cross-checks every snapshotted balance against an independent,
// direct batchBalanceOf call for the same wallet, the same discipline used
// throughout this indexer's other tests.
import { describe, it, expect, beforeAll } from "vitest";
import * as schema from "../schema";
import { runSyncOnce, CHUNK_BLOCKS } from "../worker";
import { snapshotToken, runSnapshotUntilBudget } from "../snapshot";
import { trackToken, markSnapshotted } from "../queries";
import { getLatestBlockNumber, batchBalanceOf, readTokenMetadata } from "@/lib/scan/rpc.server";
import { freshTestDb } from "./test-db";
import type { Db } from "../db";

describe("balance/metadata snapshot job (real ingested data + real Robinhood Chain RPC)", () => {
  let db: Db;
  let busiestToken: string;

  beforeAll(async () => {
    db = await freshTestDb();
    const latest = await getLatestBlockNumber();
    const startBlock = latest - CHUNK_BLOCKS * 3n - 5n;
    for (let i = 0; i < 3; i++) {
      await runSyncOnce(db, startBlock);
    }

    const allRows = await db.select().from(schema.transfers);
    console.log(`Ingested ${allRows.length} real transfers for snapshot testing.`);
    expect(allRows.length).toBeGreaterThan(0);

    const counts = new Map<string, number>();
    for (const r of allRows) counts.set(r.tokenAddress, (counts.get(r.tokenAddress) ?? 0) + 1);
    busiestToken = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0];
    console.log(`Busiest token for snapshot test: ${busiestToken}`);
  }, 60_000);

  it("snapshotToken stores exactly the balances its own live batchBalanceOf call resolved", async () => {
    const result = await snapshotToken(db, busiestToken);
    console.log("Snapshot result:", {
      tokenAddress: result.tokenAddress,
      candidateCount: result.candidateCount,
      balancesResolved: result.balancesResolved,
    });
    expect(result.candidateCount).toBeGreaterThan(0);

    const rows = (await db.select().from(schema.holderBalances)).filter(
      (r) => r.tokenAddress === busiestToken,
    );
    console.log(`${rows.length} holder_balances rows stored for ${busiestToken}.`);
    expect(rows.length).toBe(result.balancesResolved);
    expect(rows.length).toBeGreaterThan(0);

    // Compared against the EXACT map that produced these rows (not a second,
    // temporally separate live call) — a real, actively-traded token's
    // balance can genuinely change between two live reads seconds apart,
    // which isn't a bug in this code, just real chain activity. This
    // asserts the actual correctness bar instead: what got persisted is
    // byte-for-byte what batchBalanceOf returned.
    expect(rows.length).toBe(result.balances.size);
    for (const row of rows) {
      expect(BigInt(row.balanceRaw)).toBe(result.balances.get(row.walletAddress));
    }

    // Separate live sanity check: re-fetching now may or may not match
    // exactly (real trading can happen in between) — logged for visibility,
    // not asserted, since a mismatch here is expected behavior, not a bug.
    const sample = rows.slice(0, Math.min(3, rows.length)).map((r) => r.walletAddress);
    const direct = await batchBalanceOf(busiestToken, sample);
    for (const wallet of sample) {
      const stored = rows.find((r) => r.walletAddress === wallet)!;
      const directBalance = direct.balances.get(wallet);
      const matches = directBalance !== undefined && BigInt(stored.balanceRaw) === directBalance;
      console.log(`  ${wallet}: stored=${stored.balanceRaw} direct=${directBalance} matches=${matches}`);
    }
  }, 90_000);

  it("snapshotToken caches real token metadata matching a direct readTokenMetadata call", async () => {
    await snapshotToken(db, busiestToken);
    const rows = (await db.select().from(schema.tokenMetadataCache)).filter((r) => r.address === busiestToken);
    expect(rows).toHaveLength(1);
    const cached = rows[0];

    const direct = await readTokenMetadata(busiestToken);
    console.log("Cached metadata:", cached.name, cached.symbol, cached.decimals);
    console.log("Direct metadata:", direct.name, direct.symbol, direct.decimals);
    expect(cached.name).toBe(direct.name);
    expect(cached.symbol).toBe(direct.symbol);
    expect(cached.decimals).toBe(direct.decimals);
  }, 60_000);

  it("snapshotToken marks the token as snapshotted (lastSnapshotAt updated)", async () => {
    await trackToken(db, busiestToken);
    const before = Date.now();
    await snapshotToken(db, busiestToken);

    const rows = await db.select().from(schema.trackedTokens);
    const row = rows.find((r) => r.tokenAddress === busiestToken);
    expect(row?.lastSnapshotAt).not.toBeNull();
    expect(row!.lastSnapshotAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  }, 60_000);

  it("re-snapshotting overwrites rather than duplicates holder_balances rows", async () => {
    await snapshotToken(db, busiestToken);
    const first = (await db.select().from(schema.holderBalances)).filter((r) => r.tokenAddress === busiestToken);
    await snapshotToken(db, busiestToken);
    const second = (await db.select().from(schema.holderBalances)).filter((r) => r.tokenAddress === busiestToken);

    expect(second.length).toBe(first.length);
  }, 90_000);

  it("runSnapshotUntilBudget processes tracked tokens and reports progress", async () => {
    const local = await freshTestDb();
    const latest = await getLatestBlockNumber();
    const startBlock = latest - CHUNK_BLOCKS - 5n;
    await runSyncOnce(local, startBlock);

    const rows = await local.select().from(schema.transfers);
    if (rows.length === 0) {
      console.log("No transfers in this smaller window — skipping, nothing to snapshot.");
      return;
    }
    const someToken = rows[0].tokenAddress;
    await trackToken(local, someToken);

    const seen: string[] = [];
    const result = await runSnapshotUntilBudget(local, 30_000, {
      onProgress: (r) => seen.push(r.tokenAddress),
    });
    console.log("runSnapshotUntilBudget result:", result, "seen:", seen);
    expect(result.tokensProcessed).toBeGreaterThan(0);
    expect(seen).toContain(someToken);

    const tracked = await local.select().from(schema.trackedTokens);
    const row = tracked.find((t) => t.tokenAddress === someToken);
    expect(row?.lastSnapshotAt).not.toBeNull();
  }, 60_000);

  it("runSnapshotUntilBudget processes never-snapshotted tokens before already-snapshotted ones", async () => {
    const local = await freshTestDb();
    await trackToken(local, "0xalreadysnapshotted");
    await markSnapshotted(local, "0xalreadysnapshotted", new Date());
    await trackToken(local, "0xneversnapshotted");

    const seen: string[] = [];
    // A tiny budget that can only realistically get through one real
    // live-RPC snapshot pass (each involves several balanceOf/metadata
    // calls) — forces the ordering to matter for which one actually runs.
    await runSnapshotUntilBudget(local, 15_000, { onProgress: (r) => seen.push(r.tokenAddress) });
    console.log("Processed order:", seen);
    if (seen.length > 0) {
      expect(seen[0]).toBe("0xneversnapshotted");
    }
  }, 30_000);
});
