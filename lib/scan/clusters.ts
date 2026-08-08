// Cluster detection ("co-funded wallets") — split out of analyze.server.ts
// specifically so lib/indexer/hybrid-clusters.ts (the DB-backed
// replacement, used FROM analyze.server.ts) can import detectWalletClusters
// as its fallback without creating a circular import between the two
// modules (analyze.server.ts -> hybrid-clusters.ts -> analyze.server.ts).
// Pure logic, no dependency on analyze.server.ts itself.
import type { RawTransfer } from "./rpc.server";
import type { WalletGroup, WalletRole } from "./types";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export interface ClusterRow {
  addr: string;
  pct: number;
  role: WalletRole;
}

export function short(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function detectWalletClusters(
  transfers: RawTransfer[],
  excluded: ReadonlySet<string>,
  rows: ClusterRow[],
  deployer?: string,
  scanBlocks = 50_000n,
): WalletGroup[] {
  const funders = new Map<string, string>();
  for (const transfer of [...transfers].sort((a, b) => Number(a.blockNumber - b.blockNumber))) {
    const from = transfer.from.toLowerCase();
    const to = transfer.to.toLowerCase();
    if (excluded.has(from) || excluded.has(to)) continue;
    if (!funders.has(to) && from !== ZERO_ADDRESS) funders.set(to, from);
  }

  const byFunder = new Map<string, string[]>();
  for (const [wallet, funder] of funders) {
    const wallets = byFunder.get(funder) ?? [];
    wallets.push(wallet);
    byFunder.set(funder, wallets);
  }

  const pctByWallet = new Map(rows.map((row) => [row.addr.toLowerCase(), row.pct]));
  const groups: WalletGroup[] = [];
  for (const [funder, wallets] of byFunder) {
    if (wallets.length < 2) continue;
    const clusterWallets = [funder, ...wallets];
    const pctSupply = clusterWallets.reduce((sum, wallet) => sum + (pctByWallet.get(wallet) ?? 0), 0);
    const isDev = deployer?.toLowerCase() === funder;
    groups.push({
      id: `g-${groups.length}`,
      label: isDev ? "Developer-funded cluster" : `Co-funded cluster · ${short(funder)}`,
      wallets: clusterWallets,
      pctSupply: +pctSupply.toFixed(2),
      risk: pctSupply > 15 ? "high" : pctSupply > 6 ? "medium" : "low",
      note: isDev
        ? "Wallets funded directly by the deployer during the observation window."
        : `Wallets that share a common funding source (${short(funder)}) within the observation window.`,
      reason: `${wallets.length} wallets received their first observed inbound transfer from ${short(funder)} inside the last ${scanBlocks.toString()} blocks.`,
    });
  }

  return groups.sort((a, b) => b.pctSupply - a.pctSupply).slice(0, 8);
}
