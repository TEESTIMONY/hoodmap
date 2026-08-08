// Drop-in-compatible source for wallet-analyze.server.ts's tiered
// fetchWalletTransferLogs sweep — same RawWalletTransfer[] shape, so wiring
// this in bounds the caller's own live tiered loop instead of replacing the
// (currently well-tested) PnL reconstruction pipeline downstream of it.
//
// Behavior:
// - First-ever lookup for this wallet: registers it for background
//   backfill (see trackedWallets/wallet-backfill.ts) as a side effect —
//   this itself makes it "tracked" immediately, so the result comes back
//   as source:"db-partial" with dbCoverageFromBlock essentially "now" (no
//   real history accumulated yet). Practically indistinguishable from a
//   pure live scan for THIS request, but every scan after this one
//   benefits from whatever the background job accumulates in the
//   meantime.
// - Backfill still in progress (db-partial, with real coverage): returns
//   everything stored so far (real, permanent, from wherever backfill has
//   reached to the present) and tells the caller how far back that
//   coverage is reliable (dbCoverageFromBlock) — the caller's own tiered
//   live scan should only need to cover older blocks than that, never redo
//   what the DB already has.
// - Backfill complete (db-full): the DB genuinely holds this wallet's
//   entire history back to genesis (dbCoverageFromBlock = 0n) — the caller
//   doesn't need its own tiered scan at all, just this function's result.
// - source:"rpc-only" happens only when DATABASE_URL isn't configured or
//   the DB errors — a database problem must never be the reason a wallet
//   scan fails, same safety pattern as every other hybrid module in this
//   directory.
import { getAddress, type Address } from "viem";
import { fetchWalletTransferLogs, getLatestBlockNumber, type RawWalletTransfer } from "@/lib/scan/rpc.server";
import { trackWallet, getTrackedWalletStatus, getTrackedWalletTransfers } from "./queries";
import { db as getDb } from "./db";

export interface HybridWalletResult {
  transfers: RawWalletTransfer[];
  source: "db-full" | "db-partial" | "rpc-only";
  // How far back the DB's contribution is genuinely, completely reliable —
  // callers doing their own live top-up for older history should fetch
  // only blocks strictly older than this, not re-cover it. null when
  // there's no DB contribution at all (rpc-only).
  dbCoverageFromBlock: bigint | null;
  failedFetches: number;
  totalFetches: number;
}

const EMPTY_RESULT: HybridWalletResult = {
  transfers: [],
  source: "rpc-only",
  dbCoverageFromBlock: null,
  failedFetches: 0,
  totalFetches: 0,
};

function rowToRawTransfer(
  wallet: string,
  row: Awaited<ReturnType<typeof getTrackedWalletTransfers>>[number],
): RawWalletTransfer {
  const walletAddr = getAddress(wallet) as Address;
  const counterparty = getAddress(row.counterparty) as Address;
  return {
    token: getAddress(row.tokenAddress) as Address,
    from: row.direction === "out" ? walletAddr : counterparty,
    to: row.direction === "out" ? counterparty : walletAddr,
    valueRaw: BigInt(row.valueRaw),
    blockNumber: row.blockNumber,
    txHash: row.txHash as `0x${string}`,
    logIndex: row.logIndex,
  };
}

// Generous relative to what a ~15-minute freshness gap should realistically
// produce for one wallet — this is the same "bridge whatever the indexer
// hasn't synced yet" tail fetchTransferLogsHybrid already does for
// token-level scans, just wallet-scoped.
const TAIL_MAX_LOGS = 2_000;

export async function resolveWalletTransfersHybrid(wallet: string): Promise<HybridWalletResult> {
  if (!process.env.DATABASE_URL) return EMPTY_RESULT;

  const address = getAddress(wallet);
  const addrLower = address.toLowerCase();
  const db = getDb();

  try {
    const latest = await getLatestBlockNumber();
    // Awaited (not fire-and-forget, unlike hybrid-balances.ts's trackToken)
    // specifically because this same function immediately reads the row
    // back below — without awaiting, a first-ever lookup would race its
    // own insert and unpredictably see or miss it.
    await trackWallet(db, addrLower, latest);

    const status = await getTrackedWalletStatus(db, addrLower);
    if (!status) return EMPTY_RESULT; // shouldn't happen right after trackWallet, but never assume

    const storedRows = await getTrackedWalletTransfers(db, addrLower);
    const stored = storedRows.map((r) => rowToRawTransfer(addrLower, r));

    // Bridge whatever's happened since the indexer's last write for this
    // wallet — forward-capture only sees what the chain-wide sync has
    // processed so far (up to ~15 min behind the true chain tip).
    const dbMaxBlock = stored.reduce(
      (max, t) => (t.blockNumber > max ? t.blockNumber : max),
      status.trackedFromBlock,
    );
    const tailFrom = dbMaxBlock + 1n;
    const tail =
      tailFrom <= latest
        ? await fetchWalletTransferLogs(address, tailFrom, latest, TAIL_MAX_LOGS)
        : { transfers: [], failedFetches: 0, totalFetches: 0, truncated: false };

    const seen = new Set<string>();
    const merged: RawWalletTransfer[] = [];
    for (const t of [...tail.transfers, ...stored]) {
      const key = `${t.txHash}:${t.logIndex}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(t);
    }
    merged.sort((a, b) => (a.blockNumber > b.blockNumber ? 1 : a.blockNumber < b.blockNumber ? -1 : 0));

    const dbCoverageFromBlock = status.backfillComplete
      ? 0n
      : (status.backfillCursorBlock ?? status.trackedFromBlock);

    return {
      transfers: merged,
      source: status.backfillComplete ? "db-full" : "db-partial",
      dbCoverageFromBlock,
      failedFetches: tail.failedFetches,
      totalFetches: tail.totalFetches,
    };
  } catch {
    return EMPTY_RESULT;
  }
}
