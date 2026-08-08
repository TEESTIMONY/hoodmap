// Drop-in-compatible replacement for analyze.server.ts's live
// detectWalletClusters — same output shape (WalletGroup[]) — built from
// wallet_funders, maintained incrementally by the ingest worker across
// every transfer it processes within its retention window (see
// lib/indexer/prune.ts — currently ~20 hours, NOT unbounded), with no
// MAX_TRANSFER_LOGS cap the way the live scanner's transfer set has. For a
// busy token this can still see meaningfully more of a token's activity
// than the live scanner's capped candidate set, even though the nominal
// block window is no longer strictly wider than SCAN_BLOCKS.
//
// Unlike balance data, cluster detection has no "starting balance"
// correctness trap: a funding relationship only needs to have been SEEN
// once, not accounted for from genesis, so this is safe to fully trust
// from whatever the indexer has covered so far — no live-RPC merge
// needed the way fetchTransferLogsHybrid needs one for freshness.
import { detectWalletClusters, short, type ClusterRow } from "@/lib/scan/clusters";
import type { RawTransfer } from "@/lib/scan/rpc.server";
import type { WalletGroup } from "@/lib/scan/types";
import { getFunderGroups } from "./queries";
import { db as getDb } from "./db";

export interface HybridClusterResult {
  groups: WalletGroup[];
  source: "db" | "rpc-only";
}

export async function detectWalletClustersHybrid(
  tokenAddress: string,
  transfers: RawTransfer[],
  excluded: ReadonlySet<string>,
  rows: ClusterRow[],
  deployer: string | undefined,
  scanBlocks: bigint,
): Promise<HybridClusterResult> {
  let dbGroups: Awaited<ReturnType<typeof getFunderGroups>> = [];
  let dbAvailable = false;

  if (process.env.DATABASE_URL) {
    try {
      dbGroups = await getFunderGroups(getDb(), tokenAddress);
      dbAvailable = true;
    } catch {
      // A database problem must never be the reason cluster detection
      // fails — fall through to the unmodified live path below exactly as
      // if DATABASE_URL had never been set.
      dbAvailable = false;
    }
  }

  if (!dbAvailable || dbGroups.length === 0) {
    return { groups: detectWalletClusters(transfers, excluded, rows, deployer, scanBlocks), source: "rpc-only" };
  }

  // Same exclusion the live version applies (liquidity-like/burn/zero) —
  // computed by the caller from the resolved holder set, since that
  // classification needs aggregate in/out flow context wallet_funders
  // doesn't carry on its own.
  const pctByWallet = new Map(rows.map((row) => [row.addr.toLowerCase(), row.pct]));
  const groups: WalletGroup[] = [];
  for (const g of dbGroups) {
    if (excluded.has(g.funderAddress)) continue;
    const members = g.members.filter((w) => !excluded.has(w));
    if (members.length < 2) continue;
    const clusterWallets = [g.funderAddress, ...members];
    // Same as the live version: a member outside the resolved holder set
    // (pctByWallet) contributes 0 to pctSupply, not an error — we simply
    // don't have a balance for it. Already how the live version behaves
    // for any cluster member outside its own candidate set, not a new
    // limitation introduced here.
    const pctSupply = clusterWallets.reduce((sum, w) => sum + (pctByWallet.get(w) ?? 0), 0);
    const isDev = deployer?.toLowerCase() === g.funderAddress;
    groups.push({
      id: `g-${groups.length}`,
      label: isDev ? "Developer-funded cluster" : `Co-funded cluster · ${short(g.funderAddress)}`,
      wallets: clusterWallets,
      pctSupply: +pctSupply.toFixed(2),
      risk: pctSupply > 15 ? "high" : pctSupply > 6 ? "medium" : "low",
      note: isDev
        ? "Wallets funded directly by the deployer, from the indexer's retained transfer history (not just this scan's own window)."
        : `Wallets that share a common funding source (${short(g.funderAddress)}), from the indexer's retained transfer history (not just this scan's own window).`,
      reason: `${members.length} wallets received their first observed inbound transfer from ${short(g.funderAddress)}, found from the indexed database rather than the last ${scanBlocks.toString()} blocks alone.`,
    });
  }

  return { groups: groups.sort((a, b) => b.pctSupply - a.pctSupply).slice(0, 8), source: "db" };
}
