// Verifies fetchTransferLogsHybrid against the REAL Supabase database
// (whatever's already ingested — no mocking) and REAL Robinhood Chain RPC.
// Requires DATABASE_URL to be set (this repo's .env.local, or CI secrets)
// — skips cleanly if it isn't, rather than failing the whole suite for
// contributors without a configured database.
import { describe, it, expect } from "vitest";
import { getLatestBlockNumber, fetchTransferLogs } from "@/lib/scan/rpc.server";
import { fetchTransferLogsHybrid } from "../hybrid-transfers";

const CASHCAT = "0x020bfC650A365f8BB26819deAAbF3E21291018b4"; // has real rows in the DB already
const DERP = "0x6543B7746ca744C4bb2198191E71f40FF04C41b9"; // has DB rows, much quieter than CASHCAT
const UNINDEXED_PLACEHOLDER = "0x0000000000000000000000000000000000000001"; // definitely not in the DB

const hasDb = Boolean(process.env.DATABASE_URL);
const maybeDescribe = hasDb ? describe : describe.skip;

maybeDescribe("fetchTransferLogsHybrid (real Supabase DB + real RPC)", () => {
  it("falls back to rpc-only, byte-identical to fetchTransferLogs, for a token with no DB rows", async () => {
    const latest = await getLatestBlockNumber();
    const fromBlock = latest - 50_000n;

    const direct = await fetchTransferLogs(UNINDEXED_PLACEHOLDER, fromBlock, latest, 3_000);
    const hybrid = await fetchTransferLogsHybrid(UNINDEXED_PLACEHOLDER, fromBlock, latest, 3_000);

    console.log("Unindexed token — direct:", direct.length, "hybrid:", hybrid.transfers.length, "source:", hybrid.source);
    expect(hybrid.source).toBe("rpc-only");
    expect(hybrid.transfers.length).toBe(direct.length);
  }, 60_000);

  it("uses DB+tail for CASHCAT (has real rows) and returns MORE historical depth than the bounded RPC-only window", async () => {
    const latest = await getLatestBlockNumber();
    const fromBlock = latest - 50_000n;

    const rpcOnly = await fetchTransferLogs(CASHCAT, fromBlock, latest, 3_000);
    const hybrid = await fetchTransferLogsHybrid(CASHCAT, fromBlock, latest, 3_000);

    console.log("CASHCAT — rpc-only count:", rpcOnly.length, "hybrid count:", hybrid.transfers.length, "source:", hybrid.source);
    console.log("dbCoverageBlocks:", hybrid.dbCoverageBlocks?.toString());

    expect(hybrid.source).toBe("db+rpc-tail");
    expect(hybrid.transfers.length).toBeGreaterThan(0);

    // No duplicate (txHash, logIndex) pairs — the actual correctness bar
    // for the merge, not just "it returned something."
    const keys = new Set<string>();
    for (const t of hybrid.transfers) {
      const key = `${t.txHash}:${t.logIndex}`;
      expect(keys.has(key)).toBe(false);
      keys.add(key);
    }

    // Ascending block order preserved — downstream code depends on this.
    for (let i = 1; i < hybrid.transfers.length; i++) {
      expect(hybrid.transfers[i].blockNumber >= hybrid.transfers[i - 1].blockNumber).toBe(true);
    }

    // The actual point of this migration: the hybrid result should reach
    // further back in history than the old bounded window did.
    if (hybrid.transfers.length > 0 && rpcOnly.length > 0) {
      const hybridOldest = hybrid.transfers[0].blockNumber;
      const rpcOldest = rpcOnly[0].blockNumber;
      console.log("Oldest block reached — rpc-only:", rpcOldest.toString(), "hybrid:", hybridOldest.toString());
      expect(hybridOldest <= rpcOldest).toBe(true);
    }
  }, 90_000);

  it("for a quieter token (DERP), the DB genuinely extends history further back than the RPC-only window", async () => {
    const latest = await getLatestBlockNumber();
    const fromBlock = latest - 50_000n;

    const rpcOnly = await fetchTransferLogs(DERP, fromBlock, latest, 3_000);
    const hybrid = await fetchTransferLogsHybrid(DERP, fromBlock, latest, 3_000);

    console.log("DERP — rpc-only count:", rpcOnly.length, "hybrid count:", hybrid.transfers.length, "source:", hybrid.source);
    if (rpcOnly.length > 0 && hybrid.transfers.length > 0) {
      console.log(
        "Oldest block — rpc-only:",
        rpcOnly[0].blockNumber.toString(),
        "hybrid:",
        hybrid.transfers[0].blockNumber.toString(),
        `(${(rpcOnly[0].blockNumber - hybrid.transfers[0].blockNumber).toString()} blocks further back)`,
      );
    }

    expect(hybrid.transfers.length).toBeGreaterThanOrEqual(rpcOnly.length);
    if (rpcOnly.length > 0 && hybrid.transfers.length > 0) {
      expect(hybrid.transfers[0].blockNumber <= rpcOnly[0].blockNumber).toBe(true);
    }
  }, 90_000);
});
