// Verifies the read-side query layer against REAL ingested chain data —
// runs the actual worker sync against real Robinhood Chain RPC into a
// PGlite instance, then checks each query function's output against a
// hand-computed answer derived independently from the same raw rows. This
// catches "the query runs without erroring but returns the wrong thing,"
// which a query that merely doesn't throw would not.
import { describe, it, expect, beforeAll } from "vitest";
import * as schema from "../schema";
import { runSyncOnce, CHUNK_BLOCKS } from "../worker";
import {
  getTokenTransfers,
  getWalletTransfers,
  getTrendingTokens,
  getFunderGroups,
  trackToken,
  getTrackedTokens,
  markSnapshotted,
  getHolderBalances,
  upsertHolderBalances,
  getCachedTokenMetadata,
  upsertTokenMetadata,
} from "../queries";
import { getLatestBlockNumber } from "@/lib/scan/rpc.server";
import { freshTestDb } from "./test-db";
import type { Db } from "../db";

describe("indexer query layer (real ingested chain data, cross-checked by hand)", () => {
  let db: Db;
  let allRows: (typeof schema.transfers.$inferSelect)[];
  let startBlock: bigint;

  beforeAll(async () => {
    db = await freshTestDb();

    const latest = await getLatestBlockNumber();
    // Ingest 3 real chunks (150 blocks) so there's enough data for the
    // queries to have something meaningful to differentiate between.
    startBlock = latest - CHUNK_BLOCKS * 3n - 5n;
    for (let i = 0; i < 3; i++) {
      await runSyncOnce(db, startBlock);
    }

    allRows = await db.select().from(schema.transfers);
    console.log(`Ingested ${allRows.length} real transfers across 3 chunks for query verification.`);
    expect(allRows.length).toBeGreaterThan(0);
  }, 60_000);

  it("getTokenTransfers returns exactly the rows for one token, matching a hand count", async () => {
    // Pick whichever token has the most rows in the real ingested set —
    // guarantees a non-trivial sample without hardcoding an address that
    // might not appear in this particular live window.
    const counts = new Map<string, number>();
    for (const r of allRows) counts.set(r.tokenAddress, (counts.get(r.tokenAddress) ?? 0) + 1);
    const [busiestToken, expectedCount] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
    console.log(`Busiest token in this sample: ${busiestToken} (${expectedCount} transfers)`);

    const rows = await getTokenTransfers(db, busiestToken);
    console.log(`getTokenTransfers returned ${rows.length} rows`);
    expect(rows.length).toBe(expectedCount);
  });

  it("getWalletTransfers returns exactly the rows involving one real wallet, matching a hand count", async () => {
    const counts = new Map<string, number>();
    for (const r of allRows) {
      counts.set(r.fromAddress, (counts.get(r.fromAddress) ?? 0) + 1);
      counts.set(r.toAddress, (counts.get(r.toAddress) ?? 0) + 1);
    }
    const [busiestWallet, expectedCount] = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
    console.log(`Busiest wallet in this sample: ${busiestWallet} (${expectedCount} legs)`);

    const rows = await getWalletTransfers(db, busiestWallet);
    console.log(`getWalletTransfers returned ${rows.length} rows`);
    expect(rows.length).toBe(expectedCount);
    for (const r of rows) {
      expect(r.fromAddress === busiestWallet || r.toAddress === busiestWallet).toBe(true);
    }
  });

  it("getTrendingTokens ranks tokens by unique-trader count, matching a hand computation", async () => {
    const tradersByToken = new Map<string, Set<string>>();
    const transferCountByToken = new Map<string, number>();
    for (const r of allRows) {
      const set = tradersByToken.get(r.tokenAddress) ?? new Set<string>();
      set.add(r.fromAddress);
      set.add(r.toAddress);
      tradersByToken.set(r.tokenAddress, set);
      transferCountByToken.set(r.tokenAddress, (transferCountByToken.get(r.tokenAddress) ?? 0) + 1);
    }
    // Same tie-break as the SQL query itself (unique traders, then transfer
    // count, then address ascending) — without matching it exactly, a real
    // tie makes this comparison flaky depending on which real chain data
    // happened to be ingested for this run. Confirmed live: this exact
    // scenario occurred in a real test run before the tie-break was added.
    const expectedTop = Array.from(tradersByToken.entries())
      .map(([addr, set]) => [addr, set.size, transferCountByToken.get(addr) ?? 0] as const)
      .sort((a, b) => b[1] - a[1] || b[2] - a[2] || a[0].localeCompare(b[0]))[0];
    console.log(`Hand-computed top token by unique traders: ${expectedTop[0]} (${expectedTop[1]} traders)`);

    const rows = await getTrendingTokens(db, startBlock, 10);
    console.log(
      "getTrendingTokens result:",
      rows.map((r) => `${r.tokenAddress}: ${r.uniqueTraders} traders, ${r.transferCount} transfers`),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].tokenAddress).toBe(expectedTop[0]);
    expect(rows[0].uniqueTraders).toBe(expectedTop[1]);
  });

  it("getFunderGroups matches a hand-built grouping of the same ingested funder relationships", async () => {
    const funderRows = await db.select().from(schema.walletFunders);
    console.log(`${funderRows.length} funder relationships recorded during ingestion.`);

    // Hand-build the same grouping getFunderGroups is supposed to produce.
    const byFunder = new Map<string, { tokenAddress: string; members: Set<string>; earliest: bigint }[]>();
    for (const r of funderRows) {
      const list = byFunder.get(r.funderAddress) ?? [];
      let entry = list.find((e) => e.tokenAddress === r.tokenAddress);
      if (!entry) {
        entry = { tokenAddress: r.tokenAddress, members: new Set(), earliest: r.firstFundedBlock };
        list.push(entry);
      }
      entry.members.add(r.walletAddress);
      if (r.firstFundedBlock < entry.earliest) entry.earliest = r.firstFundedBlock;
      byFunder.set(r.funderAddress, list);
    }

    // Pick a real (token, funder) pair that actually has 2+ members —
    // guarantees a non-trivial case rather than hardcoding an address that
    // might not appear in this run's live data.
    let picked: { tokenAddress: string; funderAddress: string; expectedMembers: Set<string>; expectedEarliest: bigint } | null =
      null;
    for (const [funderAddress, entries] of byFunder) {
      for (const e of entries) {
        if (e.members.size >= 2) {
          picked = { tokenAddress: e.tokenAddress, funderAddress, expectedMembers: e.members, expectedEarliest: e.earliest };
          break;
        }
      }
      if (picked) break;
    }

    if (!picked) {
      console.log("No funder in this run's live data funded 2+ wallets for the same token — skipping assertion, nothing to compare.");
      return;
    }

    const groups = await getFunderGroups(db, picked.tokenAddress);
    const match = groups.find((g) => g.funderAddress === picked!.funderAddress);
    console.log(
      `Checking funder ${picked.funderAddress} on token ${picked.tokenAddress}: expected ${picked.expectedMembers.size} members, got ${match?.members.length ?? "NOT FOUND"}.`,
    );
    expect(match).toBeDefined();
    expect(new Set(match!.members)).toEqual(picked.expectedMembers);
    expect(match!.earliestFundedBlock).toBe(picked.expectedEarliest);
  });

  // ─── tracking / balance-snapshot / metadata-cache query functions ───────
  // Uses a separate, isolated PGlite instance rather than the shared
  // `db`/`allRows` fixture above — these functions don't depend on real
  // ingested transfer data, and a fresh DB makes each case's row counts
  // exact and independent of whatever the live chain happened to contain
  // this run.

  it("trackToken is idempotent (onConflictDoNothing) and preserves firstTrackedAt across re-registration", async () => {
    const local = await freshTestDb();
    const token = "0xTrackMe";

    await trackToken(local, token);
    const first = await local.select().from(schema.trackedTokens);
    expect(first).toHaveLength(1);
    expect(first[0].tokenAddress).toBe(token.toLowerCase());
    expect(first[0].lastSnapshotAt).toBeNull();

    const firstTrackedAt = first[0].firstTrackedAt;
    await new Promise((r) => setTimeout(r, 20));
    await trackToken(local, token); // re-register, should no-op

    const second = await local.select().from(schema.trackedTokens);
    expect(second).toHaveLength(1);
    expect(second[0].firstTrackedAt).toEqual(firstTrackedAt);
  }, 30_000);

  it("getTrackedTokens orders never-snapshotted tokens first, then oldest-snapshotted first", async () => {
    const local = await freshTestDb();
    await trackToken(local, "0xNeverSnapshotted");
    await trackToken(local, "0xSnapshottedOld");
    await trackToken(local, "0xSnapshottedRecent");

    await markSnapshotted(local, "0xSnapshottedOld", new Date("2020-01-01T00:00:00Z"));
    await markSnapshotted(local, "0xSnapshottedRecent", new Date("2025-01-01T00:00:00Z"));

    const rows = await getTrackedTokens(local);
    console.log("getTrackedTokens order:", rows.map((r) => r.tokenAddress));
    expect(rows.map((r) => r.tokenAddress)).toEqual([
      "0xneversnapshotted",
      "0xsnapshottedold",
      "0xsnapshottedrecent",
    ]);
  }, 30_000);

  it("upsertHolderBalances overwrites a previous snapshot for the same wallet rather than duplicating it", async () => {
    const local = await freshTestDb();
    const token = "0xTokenA";
    await upsertHolderBalances(
      local,
      token,
      new Map([
        ["0xwallet1", 100n],
        ["0xwallet2", 200n],
      ]),
    );
    let balances = await getHolderBalances(local, token);
    expect(balances.get("0xwallet1")).toBe(100n);
    expect(balances.get("0xwallet2")).toBe(200n);
    expect(balances.size).toBe(2);

    // Re-snapshot: wallet1's balance changed, wallet2 is untouched by this
    // call (a real snapshot pass always writes every candidate it
    // resolved, but the DB-level overwrite behavior is what's under test
    // here, not the job's calling convention).
    await upsertHolderBalances(local, token, new Map([["0xwallet1", 999n]]));
    balances = await getHolderBalances(local, token);
    expect(balances.get("0xwallet1")).toBe(999n);
    expect(balances.get("0xwallet2")).toBe(200n);
    expect(balances.size).toBe(2);

    const rows = await local.select().from(schema.holderBalances);
    expect(rows).toHaveLength(2); // overwrite, not a duplicate row
  }, 30_000);

  it("getHolderBalances only returns rows for the requested token, not another token's balances", async () => {
    const local = await freshTestDb();
    await upsertHolderBalances(local, "0xTokenA", new Map([["0xwallet1", 111n]]));
    await upsertHolderBalances(local, "0xTokenB", new Map([["0xwallet1", 222n]]));

    const balancesA = await getHolderBalances(local, "0xTokenA");
    const balancesB = await getHolderBalances(local, "0xTokenB");
    expect(balancesA.get("0xwallet1")).toBe(111n);
    expect(balancesB.get("0xwallet1")).toBe(222n);
  }, 30_000);

  it("upsertTokenMetadata + getCachedTokenMetadata round-trip and overwrite on re-write", async () => {
    const local = await freshTestDb();
    const token = "0xTokenMeta";
    await upsertTokenMetadata(local, token, {
      name: "Test Token",
      symbol: "TEST",
      decimals: 18,
      totalSupplyRaw: 1_000_000_000_000_000_000_000n,
    });

    const cached = await getCachedTokenMetadata(local, token);
    expect(cached?.name).toBe("Test Token");
    expect(cached?.symbol).toBe("TEST");
    expect(cached?.decimals).toBe(18);
    expect(cached?.totalSupplyRaw).toBe("1000000000000000000000");

    // Re-write (simulating a later snapshot cycle after a mint changed
    // totalSupply) — must overwrite, not error or duplicate.
    await upsertTokenMetadata(local, token, {
      name: "Test Token",
      symbol: "TEST",
      decimals: 18,
      totalSupplyRaw: 2_000_000_000_000_000_000_000n,
    });
    const updated = await getCachedTokenMetadata(local, token);
    expect(updated?.totalSupplyRaw).toBe("2000000000000000000000");

    const rows = await local.select().from(schema.tokenMetadataCache);
    expect(rows).toHaveLength(1);
  }, 30_000);

  it("getCachedTokenMetadata returns null for a token that's never been cached", async () => {
    const local = await freshTestDb();
    const cached = await getCachedTokenMetadata(local, "0xNeverCached");
    expect(cached).toBeNull();
  }, 30_000);
});
