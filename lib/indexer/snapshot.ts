// Background balance/metadata snapshot job — the WRITE side of
// hybrid-balances.ts / hybrid-metadata.ts (the READ side, called from a
// scan). For each token registered in trackedTokens (added there by a live
// scan the first time anyone looks at it — see hybrid-balances.ts),
// resolves the same candidate-holder set a live scan would pick, but from
// the indexer's retained history (see lib/indexer/prune.ts — bounded to a
// retention window to control storage, not literally unbounded) rather
// than the live scanner's MAX_TRANSFER_LOGS-capped, block-bounded window,
// refreshes their balanceOf via live RPC, refreshes token metadata, and
// updates lastSnapshotAt. This is what lets a scan of an already-tracked
// token read balances straight from the database with zero live RPC calls
// (for whichever candidates the snapshot's retained-history view and the
// live scan's own window happen to agree on — see hybrid-balances.ts for
// how a mismatch is handled).
//
// `db` is injected (not imported directly), same reasoning as worker.ts:
// keeps the core loop testable against PGlite without a live database.
import { readTokenMetadata, batchBalanceOf, type RawTransfer } from "@/lib/scan/rpc.server";
import { selectCandidateHolders } from "@/lib/scan/candidates";
import {
  getTrackedTokens,
  getTokenTransfers,
  upsertHolderBalances,
  upsertTokenMetadata,
  markSnapshotted,
  type TokenTransferRow,
} from "./queries";
import type { Db } from "./db";

// Matches analyze.server.ts's HOLDERS_TO_RESOLVE — the DB snapshot should
// cover exactly the candidate set a live scan would ask for, no more, no
// less, so a scan's balance lookups land as "fully covered by the DB" as
// often as possible.
export const HOLDERS_TO_SNAPSHOT = 100;

function toRawTransfer(row: TokenTransferRow): RawTransfer {
  return {
    from: row.fromAddress as RawTransfer["from"],
    to: row.toAddress as RawTransfer["to"],
    valueRaw: BigInt(row.valueRaw),
    blockNumber: row.blockNumber,
    txHash: row.txHash as RawTransfer["txHash"],
    logIndex: row.logIndex,
  };
}

export interface SnapshotResult {
  tokenAddress: string;
  candidateCount: number;
  balancesResolved: number;
  // The exact map that got written to holder_balances — exposed mainly so
  // tests can verify storage fidelity against the exact values a single
  // live batchBalanceOf call produced, without a second, temporally
  // separated live call racing against real chain activity (a real token
  // actively trading between two live reads seconds apart is expected to
  // show a genuinely different balance, not a bug).
  balances: Map<string, bigint>;
}

export async function snapshotToken(db: Db, tokenAddress: string): Promise<SnapshotResult> {
  // Full indexed history, not a bounded window — this is the accuracy bonus
  // a snapshot job gets that the live scanner's RPC-cost-bounded window
  // doesn't: candidate selection isn't limited to "active in the last
  // 50,000 blocks."
  const rows = await getTokenTransfers(db, tokenAddress);
  const transfers = rows.map(toRawTransfer);
  const { candidates } = selectCandidateHolders(transfers, HOLDERS_TO_SNAPSHOT);

  let balances = new Map<string, bigint>();
  if (candidates.length > 0) {
    const resolved = await batchBalanceOf(tokenAddress, candidates);
    balances = resolved.balances;
    await upsertHolderBalances(db, tokenAddress, balances);
  }
  const balancesResolved = balances.size;

  try {
    const meta = await readTokenMetadata(tokenAddress);
    await upsertTokenMetadata(db, tokenAddress, meta);
  } catch {
    // Metadata refresh failing must not block the balance snapshot (the
    // more valuable half, and the actual point of this job) from being
    // recorded, and must not fail this token's whole pass — the next cycle
    // tries metadata again.
  }

  await markSnapshotted(db, tokenAddress, new Date());
  return { tokenAddress, candidateCount: candidates.length, balancesResolved, balances };
}

export interface SnapshotBatchResult {
  tokensProcessed: number;
  tokensFailed: number;
}

// Batch variant for a scheduled job (GitHub Actions, etc.) — works through
// tracked tokens ordered most-overdue-first (see getTrackedTokens) until
// either the list is exhausted or the time budget runs out, so a token
// stuck failing every cycle can't starve the rest of the batch out of a
// snapshot forever the way an unordered scan risks.
export async function runSnapshotUntilBudget(
  db: Db,
  timeBudgetMs: number,
  opts: { onProgress?: (r: SnapshotResult) => void } = {},
): Promise<SnapshotBatchResult> {
  const start = Date.now();
  const tracked = await getTrackedTokens(db);
  let tokensProcessed = 0;
  let tokensFailed = 0;

  for (const t of tracked) {
    if (Date.now() - start >= timeBudgetMs) break;
    try {
      const result = await snapshotToken(db, t.tokenAddress);
      opts.onProgress?.(result);
      tokensProcessed++;
    } catch (err) {
      // One token's live-RPC failure (bad contract, node hiccup, whatever)
      // must not stop the rest of the batch from being processed.
      tokensFailed++;
      console.error(`[snapshot] failed for ${t.tokenAddress}:`, err);
    }
  }

  return { tokensProcessed, tokensFailed };
}
