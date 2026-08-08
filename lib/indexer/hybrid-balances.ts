// Drop-in-compatible replacement for rpc.server.ts's batchBalanceOf — same
// output shape (a balances Map + a failed list) plus a `source` tag, so the
// migration into analyze.server.ts is a small call-site swap.
//
// Behavior: for each requested candidate, use the DB's periodic snapshot
// (see lib/indexer/snapshot.ts, the background job that writes it) when
// present; live balanceOf for whatever the snapshot doesn't have yet — a
// PARTIAL hybrid (same "fill the gaps live" shape as fetchTransferLogsHybrid),
// not an all-or-nothing swap. A DB error or DATABASE_URL unset degrades to
// the exact previous behavior (100% live), same safety pattern as every
// other hybrid module in this directory.
//
// Every value here — DB or live — came from a real balanceOf call against
// the chain at some point; nothing is derived/summed from transfer history,
// so there's no partial-backfill correctness trap the way materializing
// balances from indexed deltas would have. The only thing that changes is
// WHEN that call happened (on the snapshot job's schedule vs. on this
// request), so a DB-sourced balance can be stale by up to one snapshot
// cycle but is never wrong for the moment it was captured.
//
// Also auto-tracks the token (registers it in trackedTokens) as a
// side effect of every scan when DATABASE_URL is set — this is what makes
// "scan a token once live, every scan after the next snapshot cycle reads
// straight from the DB" work with no separate onboarding step. Best-effort:
// a failure here must never fail the scan itself.
import { batchBalanceOf } from "@/lib/scan/rpc.server";
import { getHolderBalances, trackToken } from "./queries";
import { db as getDb } from "./db";

export interface HybridBalanceResult {
  balances: Map<string, bigint>;
  failed: string[];
  source: "db" | "db+rpc-partial" | "rpc-only";
}

export async function resolveBalancesHybrid(
  tokenAddress: string,
  candidates: string[],
): Promise<HybridBalanceResult> {
  if (candidates.length === 0) return { balances: new Map(), failed: [], source: "rpc-only" };

  if (!process.env.DATABASE_URL) {
    const live = await batchBalanceOf(tokenAddress, candidates);
    return { ...live, source: "rpc-only" };
  }

  trackToken(getDb(), tokenAddress).catch(() => {});

  let dbBalances: Map<string, bigint>;
  try {
    dbBalances = await getHolderBalances(getDb(), tokenAddress);
  } catch {
    // DB unreachable/misconfigured — fall through to fully live, exactly as
    // if DATABASE_URL had never been set. A database problem must never be
    // the reason a scan fails.
    const live = await batchBalanceOf(tokenAddress, candidates);
    return { ...live, source: "rpc-only" };
  }

  const fromDb = new Map<string, bigint>();
  const missing: string[] = [];
  for (const addr of candidates) {
    const lower = addr.toLowerCase();
    const bal = dbBalances.get(lower);
    if (bal !== undefined) fromDb.set(lower, bal);
    else missing.push(addr);
  }

  if (missing.length === 0) {
    return { balances: fromDb, failed: [], source: "db" };
  }

  const live = await batchBalanceOf(tokenAddress, missing);
  const merged = new Map([...fromDb, ...live.balances]);
  return {
    balances: merged,
    failed: live.failed,
    source: fromDb.size > 0 ? "db+rpc-partial" : "rpc-only",
  };
}
