// Drop-in-compatible replacement for rpc.server.ts's fetchTransferLogs —
// same inputs, same RawTransfer[] output shape — so the migration into
// analyze.server.ts is a one-line call-site swap, not a rewrite of the
// (currently well-tested, currently correct) analysis pipeline around it.
//
// Behavior: try the indexed database first (real history, not bounded to
// a recent window). If it has nothing for this token — not yet synced,
// DATABASE_URL not configured, or a DB error — fall back to the exact
// existing live-RPC path, unchanged. If it has data, use it PLUS a live
// RPC "tail" fetch for whatever's happened since the indexer's last sync
// (typically well under the GitHub Actions schedule's 15-minute cadence),
// so recency isn't sacrificed for historical depth.
import { getAddress, type Address } from "viem";
import { fetchTransferLogs, type RawTransfer } from "@/lib/scan/rpc.server";
import { getTokenTransfers } from "./queries";
import { db as getDb } from "./db";

export interface HybridFetchResult {
  transfers: RawTransfer[];
  source: "db+rpc-tail" | "rpc-only";
  dbCoverageBlocks?: bigint; // how far back the DB contributed, for observability
}

function rowToRawTransfer(row: Awaited<ReturnType<typeof getTokenTransfers>>[number]): RawTransfer {
  return {
    from: getAddress(row.fromAddress) as Address,
    to: getAddress(row.toAddress) as Address,
    valueRaw: BigInt(row.valueRaw),
    blockNumber: row.blockNumber,
    txHash: row.txHash as `0x${string}`,
    logIndex: row.logIndex,
  };
}

export async function fetchTransferLogsHybrid(
  token: string,
  fromBlock: bigint,
  toBlock: bigint,
  maxLogs: number,
): Promise<HybridFetchResult> {
  let dbRows: Awaited<ReturnType<typeof getTokenTransfers>> = [];
  let dbAvailable = false;

  if (process.env.DATABASE_URL) {
    try {
      // +500 headroom: the merge step below can only ever shrink this back
      // down toward maxLogs (it caps the final combined set), never grow
      // it — this just avoids the DB query itself being the tight bound.
      dbRows = await getTokenTransfers(getDb(), token, { limit: maxLogs + 500 });
      dbAvailable = true;
    } catch {
      // DB unreachable/misconfigured — fall through to the live-RPC-only
      // path below exactly as if DATABASE_URL had never been set. A
      // database problem must never be the reason a scan fails.
      dbAvailable = false;
    }
  }

  if (!dbAvailable || dbRows.length === 0) {
    const rpcOnly = await fetchTransferLogs(token, fromBlock, toBlock, maxLogs);
    return { transfers: rpcOnly, source: "rpc-only" };
  }

  const dbMaxBlock = dbRows.reduce((max, r) => (r.blockNumber > max ? r.blockNumber : max), 0n);
  // Bounded by `fromBlock` (the caller's normal window start) so the tail
  // fetch can never do MORE live-RPC work than today's unmodified scan
  // already does — if the indexer has fallen behind (its schedule hasn't
  // run, a backfill is still catching up, whatever the reason), this
  // degrades gracefully to "no worse than before," not "even slower
  // because now we're also waiting on a huge gap-fill." Whenever the DB is
  // more current than `fromBlock`, this only shrinks the RPC work needed.
  const tailFrom = dbMaxBlock + 1n > fromBlock ? dbMaxBlock + 1n : fromBlock;
  const tailRows = tailFrom <= toBlock ? await fetchTransferLogs(token, tailFrom, toBlock, maxLogs) : [];

  const converted = dbRows.map(rowToRawTransfer);

  const seen = new Set<string>();
  const merged: RawTransfer[] = [];
  // Tail (freshest) first so that if the same transfer somehow exists in
  // both sets (a sync race right at the boundary), the live-RPC version —
  // fetched just now — wins over a possibly-momentarily-stale DB row.
  for (const t of [...tailRows, ...converted]) {
    const key = `${t.txHash}:${t.logIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(t);
  }

  // Cap by keeping the MOST RECENT maxLogs transfers when there's more
  // than fits — not whichever end happened to be processed first. A live
  // holder/cluster snapshot is more useful biased toward "what's true
  // right now" than toward "whatever was found first."
  merged.sort((a, b) => (a.blockNumber < b.blockNumber ? 1 : a.blockNumber > b.blockNumber ? -1 : 0));
  const capped = merged.slice(0, maxLogs);
  // Restore ascending order — fetchTransferLogs' existing contract, and
  // what downstream code (e.g. detectWalletClusters' co-funding detection,
  // which reasons about "first observed transfer") assumes.
  capped.sort((a, b) => (a.blockNumber > b.blockNumber ? 1 : a.blockNumber < b.blockNumber ? -1 : 0));

  return { transfers: capped, source: "db+rpc-tail", dbCoverageBlocks: toBlock - dbRows[dbRows.length - 1]!.blockNumber };
}
