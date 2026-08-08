// Read-side query layer — the DB-backed equivalents of what the live scan
// pipeline currently does via bounded RPC calls. Not wired into
// analyze.server.ts / discover.server.ts / wallet-analyze.server.ts yet
// (see README.md's migration order) — built and verified standalone first
// so the migration itself is a small, low-risk swap once real data exists,
// not something written and tested for the first time under pressure.
import { and, desc, eq, gte, or, sql } from "drizzle-orm";
import {
  transfers,
  walletFunders,
  trackedTokens,
  holderBalances,
  tokenMetadataCache,
  trackedWallets,
  walletTransfers,
} from "./schema";
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
// constraint at the query level (an indexed query against local data isn't
// a request that risks timing out) — but the transfers table itself IS
// bounded, by lib/indexer/prune.ts's retention window (currently ~20
// hours), to control storage. "This token's entire retained history," not
// literally entire history back to genesis.
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
// indexed query across the wallet's retained cross-token history (see
// lib/indexer/prune.ts — bounded to ~20 hours, not literally forever), no
// RPC-cost-driven tiering needed — that tiering existed specifically to
// bound live RPC cost, which doesn't apply to a query against already-
// ingested data.
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
    -- Deterministic tie-break (transfer count, then address) — without one,
    -- a tie on unique-trader count leaves ordering up to whatever order
    -- Postgres happens to produce, which isn't guaranteed stable across
    -- runs. Confirmed live: this exact tie surfaced in a real test run.
    order by count(distinct addr) desc, count(*) desc, token_address asc
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

export interface FunderGroup {
  funderAddress: string;
  // Wallets this funder funded (excludes the funder itself) — matches
  // WalletGroup's `[funder, ...wallets]` convention at the call site, not
  // stored that way here.
  members: string[];
  earliestFundedBlock: bigint;
}

// Replaces analyze.server.ts's live detectWalletClusters for the "which
// wallets share a funder" question — grouped from wallet_funders, which
// the worker maintains across ALL indexed history, not just whatever fits
// in the live scanner's MAX_TRANSFER_LOGS cap. This is why cluster
// detection can genuinely improve from the indexer in a way holder
// balances can't (yet) — funding relationships don't need a "starting
// balance," they just need to have seen the transfer, so there's no
// partial-backfill correctness trap here the way there is for balances.
//
// Deliberately does NOT apply the live version's liquidity-pool/burn
// exclusion here — that needs aggregate in/out flow context this table
// doesn't carry. Callers (analyze.server.ts) already compute that
// classification for the token's resolved holder set and should filter
// this function's output the same way, rather than this function
// guessing at it with an incomplete picture.
export async function getFunderGroups(db: Db, tokenAddress: string): Promise<FunderGroup[]> {
  const rows = await db
    .select({
      funderAddress: walletFunders.funderAddress,
      walletAddress: walletFunders.walletAddress,
      firstFundedBlock: walletFunders.firstFundedBlock,
    })
    .from(walletFunders)
    .where(eq(walletFunders.tokenAddress, tokenAddress.toLowerCase()));

  const byFunder = new Map<string, { members: string[]; earliest: bigint }>();
  for (const r of rows) {
    const entry = byFunder.get(r.funderAddress) ?? { members: [], earliest: r.firstFundedBlock };
    entry.members.push(r.walletAddress);
    if (r.firstFundedBlock < entry.earliest) entry.earliest = r.firstFundedBlock;
    byFunder.set(r.funderAddress, entry);
  }

  return Array.from(byFunder.entries())
    .filter(([, v]) => v.members.length >= 2) // a "cluster" needs at least 2 funded wallets
    .map(([funderAddress, v]) => ({ funderAddress, members: v.members, earliestFundedBlock: v.earliest }))
    .sort((a, b) => b.members.length - a.members.length);
}

// ─── periodic balance snapshot support ─────────────────────────────────────
// See lib/indexer/hybrid-balances.ts (read side, called from a scan) and
// lib/indexer/snapshot.ts (write side, the background job) for how these
// get used together.

// Registers a token for the background snapshot job to keep fresh.
// onConflictDoNothing — a token only needs to be registered once; scanning
// it again later shouldn't reset firstTrackedAt or disturb lastSnapshotAt.
export async function trackToken(db: Db, tokenAddress: string): Promise<void> {
  await db
    .insert(trackedTokens)
    .values({ tokenAddress: tokenAddress.toLowerCase() })
    .onConflictDoNothing();
}

export interface TrackedTokenRow {
  tokenAddress: string;
  lastSnapshotAt: Date | null;
}

// Ordered oldest-snapshotted-first (nulls — never snapshotted — first of
// all) so the background job naturally works through whichever tokens are
// most overdue, rather than always starting from the same place in an
// unordered scan and starving tokens near the end of the table.
export async function getTrackedTokens(db: Db): Promise<TrackedTokenRow[]> {
  const rows = await db
    .select({ tokenAddress: trackedTokens.tokenAddress, lastSnapshotAt: trackedTokens.lastSnapshotAt })
    .from(trackedTokens)
    .orderBy(sql`${trackedTokens.lastSnapshotAt} asc nulls first`);
  return rows;
}

export async function markSnapshotted(db: Db, tokenAddress: string, when: Date): Promise<void> {
  await db
    .update(trackedTokens)
    .set({ lastSnapshotAt: when })
    .where(eq(trackedTokens.tokenAddress, tokenAddress.toLowerCase()));
}

// All wallets this token has a live-balanceOf snapshot for. A wallet
// missing from this map was never a snapshot candidate (or hasn't been
// picked up by the job yet) — callers should resolve it live rather than
// assume 0, same "absence isn't zero" rule used throughout this app's
// balance handling.
export async function getHolderBalances(db: Db, tokenAddress: string): Promise<Map<string, bigint>> {
  const rows = await db
    .select({ walletAddress: holderBalances.walletAddress, balanceRaw: holderBalances.balanceRaw })
    .from(holderBalances)
    .where(eq(holderBalances.tokenAddress, tokenAddress.toLowerCase()));
  return new Map(rows.map((r) => [r.walletAddress, BigInt(r.balanceRaw)]));
}

// Unlike wallet_funders (write-once, onConflictDoNothing), a balance
// genuinely changes over time — this must overwrite the previous snapshot,
// not no-op against it.
export async function upsertHolderBalances(
  db: Db,
  tokenAddress: string,
  balances: Map<string, bigint>,
): Promise<void> {
  if (balances.size === 0) return;
  const now = new Date();
  const rows = Array.from(balances.entries()).map(([walletAddress, balanceRaw]) => ({
    tokenAddress: tokenAddress.toLowerCase(),
    walletAddress: walletAddress.toLowerCase(),
    balanceRaw: balanceRaw.toString(),
    updatedAt: now,
  }));
  await db
    .insert(holderBalances)
    .values(rows)
    .onConflictDoUpdate({
      target: [holderBalances.tokenAddress, holderBalances.walletAddress],
      set: { balanceRaw: sql`excluded.balance_raw`, updatedAt: sql`excluded.updated_at` },
    });
}

// ─── wallet passport (full, permanent per-wallet history) ──────────────────
// See lib/indexer/hybrid-wallet-transfers.ts (read side) and
// lib/indexer/wallet-backfill.ts (background backfill) for how these get
// used together. Distinct from getWalletTransfers above, which reads the
// bulk `transfers` table — bounded by prune.ts's ~20-hour retention. This
// reads walletTransfers instead: a permanent, never-pruned log kept only
// for wallets someone has actually looked up (see trackedWallets in
// schema.ts for why "only tracked wallets," not every address that's ever
// moved a token).

// Registers a wallet for the background backfill job to walk backward from.
// onConflictDoNothing — a wallet only needs to be registered once;
// trackedFromBlock is the anchor forward-capture (worker.ts) started from,
// and must never move once set, or backward backfill and forward capture
// could both skip the blocks in between.
export async function trackWallet(db: Db, walletAddress: string, trackedFromBlock: bigint): Promise<void> {
  await db
    .insert(trackedWallets)
    .values({ walletAddress: walletAddress.toLowerCase(), trackedFromBlock })
    .onConflictDoNothing();
}

export interface TrackedWalletStatus {
  trackedFromBlock: bigint;
  backfillCursorBlock: bigint | null;
  backfillComplete: boolean;
}

// Lets a caller (hybrid-wallet-transfers.ts) report honestly how complete
// this wallet's stored history is — "since genesis" only once
// backfillComplete is true; otherwise "since block N" (backfillCursorBlock,
// or trackedFromBlock if backfill hasn't started yet), never silently
// presented as more complete than it actually is.
export async function getTrackedWalletStatus(db: Db, walletAddress: string): Promise<TrackedWalletStatus | null> {
  const rows = await db
    .select({
      trackedFromBlock: trackedWallets.trackedFromBlock,
      backfillCursorBlock: trackedWallets.backfillCursorBlock,
      backfillComplete: trackedWallets.backfillComplete,
    })
    .from(trackedWallets)
    .where(eq(trackedWallets.walletAddress, walletAddress.toLowerCase()));
  return rows[0] ?? null;
}

export interface WalletActivityRow {
  tokenAddress: string;
  counterparty: string;
  direction: "in" | "out";
  valueRaw: string;
  blockNumber: bigint;
  txHash: string;
  logIndex: number;
}

export async function getTrackedWalletTransfers(db: Db, walletAddress: string): Promise<WalletActivityRow[]> {
  const rows = await db
    .select({
      tokenAddress: walletTransfers.tokenAddress,
      counterparty: walletTransfers.counterparty,
      direction: walletTransfers.direction,
      valueRaw: walletTransfers.valueRaw,
      blockNumber: walletTransfers.blockNumber,
      txHash: walletTransfers.txHash,
      logIndex: walletTransfers.logIndex,
    })
    .from(walletTransfers)
    .where(eq(walletTransfers.walletAddress, walletAddress.toLowerCase()))
    .orderBy(desc(walletTransfers.blockNumber));
  return rows as WalletActivityRow[];
}

export interface CachedTokenMetadata {
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupplyRaw: string | null;
  updatedAt: Date;
}

export async function getCachedTokenMetadata(db: Db, tokenAddress: string): Promise<CachedTokenMetadata | null> {
  const rows = await db
    .select()
    .from(tokenMetadataCache)
    .where(eq(tokenMetadataCache.address, tokenAddress.toLowerCase()));
  return rows[0] ?? null;
}

export async function upsertTokenMetadata(
  db: Db,
  tokenAddress: string,
  meta: { name: string; symbol: string; decimals: number; totalSupplyRaw: bigint },
): Promise<void> {
  const now = new Date();
  await db
    .insert(tokenMetadataCache)
    .values({
      address: tokenAddress.toLowerCase(),
      name: meta.name,
      symbol: meta.symbol,
      decimals: meta.decimals,
      totalSupplyRaw: meta.totalSupplyRaw.toString(),
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: tokenMetadataCache.address,
      set: {
        name: meta.name,
        symbol: meta.symbol,
        decimals: meta.decimals,
        totalSupplyRaw: meta.totalSupplyRaw.toString(),
        updatedAt: now,
      },
    });
}
