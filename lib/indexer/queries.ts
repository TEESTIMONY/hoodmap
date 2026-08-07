// Read-side query layer — the DB-backed equivalents of what the live scan
// pipeline currently does via bounded RPC calls. Not wired into
// analyze.server.ts / discover.server.ts / wallet-analyze.server.ts yet
// (see README.md's migration order) — built and verified standalone first
// so the migration itself is a small, low-risk swap once real data exists,
// not something written and tested for the first time under pressure.
import { and, desc, eq, gte, or, sql } from "drizzle-orm";
import { transfers } from "./schema";
import type { Db } from "./db";

export interface TokenTransferRow {
  fromAddress: string;
  toAddress: string;
  valueRaw: string;
  blockNumber: bigint;
  txHash: string;
  logIndex: number;
}

// Replaces analyze.server.ts's fetchTransferLogs(token, fromBlock,
// latestBlock, MAX_TRANSFER_LOGS) — the live version is bounded by
// SCAN_BLOCKS (currently 50,000) and a hard transfer cap (3,000) purely to
// fit inside a serverless request's time budget. This has neither
// constraint: it's an indexed query against data that's already local, so
// "give me this token's ENTIRE history" is a normal query, not a request
// that risks timing out.
export async function getTokenTransfers(
  db: Db,
  tokenAddress: string,
  opts: { sinceBlock?: bigint; limit?: number } = {},
): Promise<TokenTransferRow[]> {
  const conditions = [eq(transfers.tokenAddress, tokenAddress.toLowerCase())];
  if (opts.sinceBlock != null) conditions.push(gte(transfers.blockNumber, opts.sinceBlock));

  const rows = await db
    .select({
      fromAddress: transfers.fromAddress,
      toAddress: transfers.toAddress,
      valueRaw: transfers.valueRaw,
      blockNumber: transfers.blockNumber,
      txHash: transfers.txHash,
      logIndex: transfers.logIndex,
    })
    .from(transfers)
    .where(and(...conditions))
    .orderBy(desc(transfers.blockNumber))
    .limit(opts.limit ?? 1_000_000);

  return rows;
}

// Replaces wallet-analyze.server.ts's tiered fetchWalletTransferLogs sweep
// (currently capped at 1,500,000 blocks / 250 transfers to fit a request's
// time budget, per this session's live-measured timing). This is one
// indexed query across the wallet's ENTIRE cross-token history, no tiering
// needed — the tiering existed specifically to bound live RPC cost, which
// doesn't apply to a query against already-ingested data.
export async function getWalletTransfers(
  db: Db,
  wallet: string,
  opts: { limit?: number } = {},
): Promise<(TokenTransferRow & { tokenAddress: string })[]> {
  const addr = wallet.toLowerCase();
  const rows = await db
    .select({
      tokenAddress: transfers.tokenAddress,
      fromAddress: transfers.fromAddress,
      toAddress: transfers.toAddress,
      valueRaw: transfers.valueRaw,
      blockNumber: transfers.blockNumber,
      txHash: transfers.txHash,
      logIndex: transfers.logIndex,
    })
    .from(transfers)
    .where(or(eq(transfers.fromAddress, addr), eq(transfers.toAddress, addr)))
    .orderBy(desc(transfers.blockNumber))
    .limit(opts.limit ?? 1_000_000);

  return rows;
}

export interface TrendingRow {
  tokenAddress: string;
  uniqueTraders: number;
  transferCount: number;
}

// Replaces discover.server.ts's live 800-block unfiltered chain-wide scan.
// That window is narrow specifically because an unfiltered getLogs across
// every contract is expensive per-block over RPC — a DB aggregate query
// has no equivalent cost, so this can safely look back much further
// (sinceBlock) without the discovery list missing a token that was active
// an hour ago but quiet in the last 27 minutes.
//
// Written as plain SQL rather than forced through drizzle's typed query
// builder — the "unique trader = distinct address across both from and to
// columns" shape doesn't map cleanly onto a single-table typed query, and
// a raw, readable UNION ALL + GROUP BY is more trustworthy here than a
// clever builder expression that's hard to eyeball for correctness.
export async function getTrendingTokens(db: Db, sinceBlock: bigint, limit = 50): Promise<TrendingRow[]> {
  const result = await db.execute(sql`
    select
      token_address as "tokenAddress",
      count(distinct addr)::int as "uniqueTraders",
      count(*)::int as "transferCount"
    from (
      select token_address, from_address as addr from ${transfers} where block_number >= ${sinceBlock}
      union all
      select token_address, to_address as addr from ${transfers} where block_number >= ${sinceBlock}
    ) t
    group by token_address
    order by count(distinct addr) desc
    limit ${limit}
  `);
  // The postgres-js driver (production) and the PGlite driver (tests) wrap
  // db.execute()'s result differently — postgres-js returns the row array
  // directly, PGlite returns a node-postgres-style { rows: [...] } object.
  // Normalizing here rather than assuming one shape keeps this correct
  // under both without the caller needing to know which driver is active.
  const rows = Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? []);
  return rows as TrendingRow[];
}
