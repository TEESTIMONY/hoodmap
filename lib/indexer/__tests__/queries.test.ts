// Verifies the read-side query layer against REAL ingested chain data —
// runs the actual worker sync against real Robinhood Chain RPC into a
// PGlite instance, then checks each query function's output against a
// hand-computed answer derived independently from the same raw rows. This
// catches "the query runs without erroring but returns the wrong thing,"
// which a query that merely doesn't throw would not.
import { describe, it, expect, beforeAll } from "vitest";
import * as schema from "../schema";
import { runSyncOnce, CHUNK_BLOCKS } from "../worker";
import { getTokenTransfers, getWalletTransfers, getTrendingTokens, getFunderGroups } from "../queries";
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
});
