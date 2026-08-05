// Live analysis pipeline for Robinhood Chain tokens, ported from HoodMap.
// Orchestrates: metadata → transfer logs → holder balances → clusters →
// score → grounded summary. Server-only.

import { formatUnits, getAddress } from "viem";
import {
  batchBalanceOf,
  batchBlockTimestamps,
  batchNativeBalance,
  estimateContractAgeSeconds,
  fetchTransferLogs,
  getLatestBlockNumber,
  isBurnAddress,
  publicClient,
  readTokenMetadata,
  RPC_URL,
  ZERO_ADDRESS,
  type RawTransfer,
} from "./rpc.server";
import type {
  AnalysisResult,
  AnalysisWarning,
  HealthMetric,
  HoodScore,
  Transfer,
  WalletEdge,
  WalletGroup,
  WalletNode,
  WalletRole,
  WhaleRow,
} from "./types";

// Scan window: last ~500,000 blocks. At ~2s block time on Robinhood Chain,
// that's roughly the last ~11.5 days — wide enough to catch most of a
// typical memecoin's active life, not just the last few hours. Used to be
// 5,000 blocks (~3 hours); widened because that narrow a window meant the
// wallet-cluster detection and whale table only ever saw wallets active
// very recently, missing real clusters and holders visible on a token's
// full history (confirmed by comparing against Bubblemaps, which showed
// several real clusters for a token where this scanner found only one).
// A real cost: fetchTransferLogs now issues far more RPC calls per scan,
// so this trades scan speed (was a few seconds) for completeness.
const SCAN_BLOCKS = 500_000n;
// How many observed addresses to resolve to real balances via balanceOf.
// 100 so HoodMap can render up to the top 100 holders (see step 8 below).
const HOLDERS_TO_RESOLVE = 100;
// Latest N transfers to show in the recent-transfers panel.
const RECENT_TRANSFERS = 25;

export interface ClusterRow {
  addr: string;
  pct: number;
  role: WalletRole;
}

export async function analyzeTokenLive(rawAddress: string): Promise<AnalysisResult> {
  const address = getAddress(rawAddress);
  const now = new Date().toISOString();
  const warnings: AnalysisWarning[] = [];

  // ── 1. Metadata + head block, in parallel
  const [meta, latestBlock] = await Promise.all([
    readTokenMetadata(address),
    getLatestBlockNumber(),
  ]);

  const fromBlock = latestBlock > SCAN_BLOCKS ? latestBlock - SCAN_BLOCKS : 0n;

  // ── 2. Transfer logs across window (+ contract-age estimate in parallel)
  // Bounds more than just the log-fetch itself: every transfer collected
  // here also needs a block-timestamp lookup downstream (batchBlockTimestamps,
  // one eth_getBlock per unique block, 20 at a time) plus cluster-detection
  // processing. A generous 25,000 cap was fine when the 5,000-block window
  // made it essentially unreachable; at the current 500,000-block window a
  // genuinely popular token can hit it, and 25,000 transfers' worth of
  // timestamp lookups alone measured well past 5 minutes without finishing
  // — worse than the old narrow-but-fast scan for exactly the tokens people
  // most want to look at. 5,000 keeps the same order of magnitude that was
  // already known to run in seconds.
  const MAX_TRANSFER_LOGS = 5_000;
  const [transfers, ageSeconds] = await Promise.all([
    fetchTransferLogs(address, fromBlock, latestBlock, MAX_TRANSFER_LOGS),
    // Binary search over eth_getCode — O(log n) RPC calls, so matching the
    // wider transfer-log window costs barely more (a couple extra probes)
    // despite searching 5x further back.
    estimateContractAgeSeconds(address, latestBlock, SCAN_BLOCKS).catch(() => undefined),
  ]);

  if (transfers.length === 0) {
    warnings.push({
      severity: "info",
      message: `No token transfers observed in the last ${SCAN_BLOCKS.toLocaleString()} blocks. Holder and cluster data will be limited.`,
    });
  } else if (transfers.length >= MAX_TRANSFER_LOGS) {
    // A very active token can exhaust the log cap well before reaching the
    // full window (this is far more likely now than at the old 5,000-block
    // window) — say so rather than silently presenting a partial scan as
    // if it covered the whole intended range.
    warnings.push({
      severity: "info",
      message:
        "This token is active enough that the transfer-log cap was hit before covering the full scan window — holder and cluster data reflects only the most recent activity within that cap, not the full window.",
    });
  }

  // ── 3. Pick candidate holders by activity, resolve real balances
  const activity = new Map<string, number>();
  for (const t of transfers) {
    const from = t.from.toLowerCase();
    const to = t.to.toLowerCase();
    if (from !== ZERO_ADDRESS) activity.set(from, (activity.get(from) ?? 0) + 1);
    if (to !== ZERO_ADDRESS) activity.set(to, (activity.get(to) ?? 0) + 1);
  }
  const candidates = Array.from(activity.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, HOLDERS_TO_RESOLVE)
    .map(([addr]) => addr);

  // Always include the deployer heuristic + zero + dead
  const deployer = guessDeployer(transfers);
  if (deployer && !candidates.includes(deployer)) candidates.push(deployer);

  const balances = candidates.length
    ? await batchBalanceOf(address, candidates)
    : new Map<string, bigint>();

  // ── 4. Detect LP / router-like addresses: contracts with high bidirectional flow
  const inflow = new Map<string, bigint>();
  const outflow = new Map<string, bigint>();
  for (const t of transfers) {
    const to = t.to.toLowerCase();
    const from = t.from.toLowerCase();
    inflow.set(to, (inflow.get(to) ?? 0n) + t.valueRaw);
    outflow.set(from, (outflow.get(from) ?? 0n) + t.valueRaw);
  }

  // A wallet is "liquidity-like" if it has substantial in AND out flow (both > 15% of the smaller side).
  const liquidityLike = new Set<string>();
  for (const addr of candidates) {
    const inn = inflow.get(addr) ?? 0n;
    const out = outflow.get(addr) ?? 0n;
    if (inn > 0n && out > 0n) {
      const smaller = inn < out ? inn : out;
      const larger = inn > out ? inn : out;
      // both sides material AND within an order of magnitude
      if (smaller * 5n > larger) liquidityLike.add(addr);
    }
  }

  // ── 5. Build holder rows, sort by balance
  interface Row extends ClusterRow {
    addr: string;
    balanceRaw: bigint;
    balance: number;
    pct: number;
    activity: number;
    role: WalletRole;
  }
  const totalSupplyRaw = meta.totalSupplyRaw > 0n ? meta.totalSupplyRaw : 1n;
  const rows: Row[] = candidates.map((addr) => {
    const balanceRaw = balances.get(addr) ?? 0n;
    const balance = Number(formatUnits(balanceRaw, meta.decimals));
    const pct = meta.totalSupply > 0 ? (balance / meta.totalSupply) * 100 : 0;
    let role: WalletRole = "holder";
    if (isBurnAddress(addr)) role = "burn";
    else if (liquidityLike.has(addr)) role = "liquidity";
    else if (addr === deployer) role = "developer";
    else if (pct >= 1) role = "whale";
    return { addr, balanceRaw, balance, pct, activity: activity.get(addr) ?? 0, role };
  });
  rows.sort((a, b) => Number(b.balanceRaw - a.balanceRaw));

  const developerRow =
    rows.find((r) => r.role === "developer") ??
    (deployer
      ? {
          addr: deployer,
          balanceRaw: 0n,
          balance: 0,
          pct: 0,
          activity: 0,
          role: "developer" as const,
        }
      : null);

  // ── 6. Distribution buckets
  const top10Pct = rows.slice(0, 10).reduce((s, r) => s + r.pct, 0);
  const top25Pct = rows.slice(0, 25).reduce((s, r) => s + r.pct, 0);
  const top100Pct = rows.slice(0, 100).reduce((s, r) => s + r.pct, 0);
  const liquidityPct = rows.filter((r) => r.role === "liquidity").reduce((s, r) => s + r.pct, 0);
  const burnPct = rows.filter((r) => r.role === "burn").reduce((s, r) => s + r.pct, 0);
  const developerPct = developerRow?.pct ?? 0;

  // ── 7. Cluster detection: connected components in the observed transfer graph,
  //     ignoring liquidity/burn nodes (they connect everyone and drown clusters).
  const excluded = new Set<string>([
    ...liquidityLike,
    ...Array.from(rows)
      .filter((r) => r.role === "burn")
      .map((r) => r.addr),
    ZERO_ADDRESS,
  ]);
  const edgeCount = new Map<string, number>(); // "a|b" -> count of transfers between them
  const sortedByBlock = [...transfers].sort((a, b) => Number(a.blockNumber - b.blockNumber));
  for (const t of sortedByBlock) {
    const from = t.from.toLowerCase();
    const to = t.to.toLowerCase();
    if (excluded.has(from) || excluded.has(to)) continue;
    const key = from < to ? `${from}|${to}` : `${to}|${from}`;
    edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
  }
  const topGroups = detectWalletClusters(transfers, excluded, rows, deployer, SCAN_BLOCKS);

  // ── 8. Wallet graph nodes/edges for the visualization — up to top 100
  // holders for HoodMap (bounded by HOLDERS_TO_RESOLVE above, since a row
  // only exists for an address that actually got a resolved balance).
  // Deliberately NOT expanded with every cluster member: a cluster can be
  // far larger than 100 wallets (observed: a single co-funded cluster with
  // 2,200+ members on a bot-heavy token), and pulling all of them in would
  // blow straight through the "up to 100" cap. groupOf below still tags
  // whichever of these top holders happen to be clustered — cluster
  // detection itself isn't touched, only which of its output gets rendered.
  const graphAddrs = new Set<string>();
  const topRows = rows.slice(0, 100);
  for (const r of topRows) graphAddrs.add(r.addr);
  if (developerRow) graphAddrs.add(developerRow.addr);
  const groupOf = new Map<string, string>();
  for (const g of topGroups) for (const w of g.wallets) groupOf.set(w, g.id);
  const nodes: WalletNode[] = Array.from(graphAddrs).map((addr) => {
    const row = rows.find((r) => r.addr === addr);
    const balance = row?.balance ?? 0;
    const pct = row?.pct ?? 0;
    const role: WalletRole = row?.role ?? "holder";
    return {
      id: addr,
      label: labelFor(addr, role, deployer),
      role,
      balance,
      pctSupply: pct,
      group: groupOf.get(addr),
    };
  });
  const edges: WalletEdge[] = [];
  const emitted = new Set<string>();
  for (const t of transfers) {
    const from = t.from.toLowerCase();
    const to = t.to.toLowerCase();
    if (!graphAddrs.has(from) || !graphAddrs.has(to)) continue;
    const key = from < to ? `${from}|${to}` : `${to}|${from}`;
    if (emitted.has(key)) continue;
    emitted.add(key);
    const kind: WalletEdge["kind"] =
      liquidityLike.has(from) || liquidityLike.has(to) ? "swap" : "transfer";
    const cnt = edgeCount.get(key) ?? 1;
    edges.push({ from, to, weight: Math.min(1, cnt / 8), kind });
  }

  // ── 9. Whale intelligence — top 12 non-liquidity holders + native balances
  const whaleRows = rows.filter((r) => r.role !== "liquidity" && r.role !== "burn").slice(0, 12);
  const nativeBalances = whaleRows.length
    ? await batchNativeBalance(whaleRows.map((r) => r.addr))
    : new Map<string, bigint>();
  const whales: WhaleRow[] = whaleRows.map((r) => ({
    address: r.addr,
    balance: r.balance,
    pctSupply: r.pct,
    nativeBalance: Number(formatUnits(nativeBalances.get(r.addr) ?? 0n, 18)),
    connectedWallets: countConnections(r.addr, edgeCount),
    recentTxs: r.activity,
    labels: labelsFor(r, deployer),
    role: r.role,
  }));

  // ── 10. Transfers with real block timestamps. `recentTransfers` (top 25,
  // unchanged) feeds the existing "Recent transfers" panel; `allTransfers`
  // exposes every transfer already scanned in step 2 — no second on-chain
  // query — so HoodMap's per-wallet Transfers view can filter it down to
  // one wallet instead of only ever seeing the top-25 sliver.
  const sortedTransfers = [...transfers].sort(
    (a, b) => Number(b.blockNumber - a.blockNumber) || b.logIndex - a.logIndex,
  );
  const tsMap = await batchBlockTimestamps(sortedTransfers.map((t) => t.blockNumber));
  const nowSec = Math.floor(Date.now() / 1000);
  const toDisplayTransfer = (t: RawTransfer): Transfer => {
    const ts = tsMap.get(t.blockNumber.toString());
    const ageSec = ts ? Math.max(0, nowSec - ts) : 0;
    const from = t.from.toLowerCase();
    const to = t.to.toLowerCase();
    const kind: Transfer["kind"] =
      from === ZERO_ADDRESS
        ? "mint"
        : isBurnAddress(to)
          ? "burn"
          : liquidityLike.has(from)
            ? "buy"
            : liquidityLike.has(to)
              ? "sell"
              : "transfer";
    return {
      hash: t.txHash,
      from,
      to,
      amount: Number(formatUnits(t.valueRaw, meta.decimals)),
      ageSeconds: ageSec,
      kind,
      blockNumber: Number(t.blockNumber),
      logIndex: t.logIndex,
    };
  };
  const allTransfers: Transfer[] = sortedTransfers.map(toDisplayTransfer);
  const recentTransfers: Transfer[] = allTransfers.slice(0, RECENT_TRANSFERS);

  // ── 11. Score + health + warnings + summary — all from observed facts
  // rows[0] (highest raw balance) is frequently a burn or liquidity address
  // rather than an actual trading wallet — using it unfiltered here made
  // the HoodScore's "Top wallet X%" language wildly inconsistent with the
  // whale table below, which already excludes those roles (line ~228):
  // e.g. one real scan reported "Top wallet 2.3%" while the whale table's
  // actual largest holder was 0.07%, because the true #1 balance belonged
  // to a burn address the whale table correctly doesn't call a "wallet".
  // Matching the same filter here keeps the two consistent.
  const topWalletPct = rows.find((r) => r.role !== "liquidity" && r.role !== "burn")?.pct ?? 0;
  const clusterPct = topGroups.reduce((s, g) => s + g.pctSupply, 0);
  const hoodScore = computeHoodScore({
    topWalletPct,
    top10Pct,
    developerPct,
    liquidityPct,
    clusterCount: topGroups.length,
    clusterPct,
    uniqueObserved: activity.size,
    transferCount: transfers.length,
  });
  const health = computeHealth({
    topWalletPct,
    top10Pct,
    developerPct,
    liquidityPct,
    clusterCount: topGroups.length,
    clusterPct,
    uniqueObserved: activity.size,
    transferCount: transfers.length,
    devActive: developerRow ? (activity.get(developerRow.addr) ?? 0) > 0 : false,
  });
  const smart = smartWarnings({
    top10Pct,
    developerPct,
    clusterCount: topGroups.length,
    clusterPct,
    latestTransfers: recentTransfers,
    totalSupply: meta.totalSupply,
  });
  warnings.push(...smart);
  const aiSummary = buildSummary({
    symbol: meta.symbol,
    uniqueObserved: activity.size,
    transferCount: transfers.length,
    topWalletPct,
    top10Pct,
    developerPct,
    liquidityPct,
    clusterCount: topGroups.length,
    clusterPct,
    devActive: developerRow ? (activity.get(developerRow.addr) ?? 0) > 0 : false,
    scanBlocks: Number(SCAN_BLOCKS),
  });

  return {
    token: {
      address: meta.address,
      name: meta.name,
      symbol: meta.symbol,
      decimals: meta.decimals,
      totalSupply: meta.totalSupply,
      createdAgoSeconds: ageSeconds,
      source: "robinhood-chain",
    },
    hoodScore,
    holderDistribution: [
      { label: "Top 1", pct: +topWalletPct.toFixed(2) },
      { label: "Top 2–10", pct: +Math.max(0, top10Pct - topWalletPct).toFixed(2) },
      { label: "Top 11–25", pct: +Math.max(0, top25Pct - top10Pct).toFixed(2) },
      { label: "Liquidity", pct: +liquidityPct.toFixed(2) },
      { label: "Burned", pct: +burnPct.toFixed(2) },
    ].filter((b) => b.pct > 0),
    holderTotals: {
      uniqueObserved: activity.size,
      top10Pct: +top10Pct.toFixed(2),
      top25Pct: +top25Pct.toFixed(2),
      top100Pct: +top100Pct.toFixed(2),
      developerPct: +developerPct.toFixed(2),
      liquidityPct: +liquidityPct.toFixed(2),
      burnPct: +burnPct.toFixed(2),
    },
    groups: topGroups,
    developer: developerRow
      ? {
          id: developerRow.addr,
          label: "Deployer",
          role: "developer",
          balance: developerRow.balance,
          pctSupply: developerRow.pct,
        }
      : {
          id: "0x",
          label: "Deployer (not observed)",
          role: "developer",
          balance: 0,
          pctSupply: 0,
        },
    liquidity: {
      totalUsd: 0, // filled client-side from DexScreener
      lockedPct: 0,
      pool: liquidityLike.size
        ? `${liquidityLike.size} liquidity-like address(es) detected on-chain`
        : "No active liquidity pool detected in scan window",
      pairAddress: Array.from(liquidityLike)[0],
    },
    transfers: recentTransfers,
    allTransfers,
    graph: { nodes, edges },
    aiSummary,
    dataSources: {
      metadata: "live",
      price: "unavailable",
      liquidity: liquidityLike.size ? "partial" : "unavailable",
      holders: rows.length ? "partial" : "unavailable",
      walletGraph: transfers.length ? "live" : "unavailable",
      transfers: transfers.length ? "live" : "unavailable",
      provider: "Robinhood Chain RPC",
      rpcUrl: RPC_URL,
      observationWindowBlocks: Number(SCAN_BLOCKS),
      observationWindowFromBlock: Number(fromBlock),
      observationWindowToBlock: Number(latestBlock),
      lastUpdated: now,
      notes: [
        `Holder balances and clusters are derived from Transfer events in blocks ${fromBlock.toString()}–${latestBlock.toString()} plus current balanceOf reads.`,
        "Balances are exact (balanceOf). Cluster detection observes only the scan window.",
      ],
    },
    whales,
    health,
    warnings,
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function guessDeployer(transfers: RawTransfer[]): string | undefined {
  // Deployer heuristic: recipient of the earliest mint (from == 0x0) in window.
  const mints = transfers
    .filter((t) => t.from.toLowerCase() === ZERO_ADDRESS)
    .sort((a, b) => Number(a.blockNumber - b.blockNumber));
  if (mints.length === 0) return undefined;
  return mints[0].to.toLowerCase();
}

function countConnections(addr: string, edgeCount: Map<string, number>): number {
  let n = 0;
  for (const key of edgeCount.keys()) {
    const [a, b] = key.split("|");
    if (a === addr || b === addr) n++;
  }
  return n;
}

function labelFor(addr: string, role: WalletRole, deployer?: string): string {
  if (addr === deployer) return "Deployer";
  if (role === "liquidity") return "Liquidity pool";
  if (role === "burn") return "Burn";
  if (role === "whale") return "Whale";
  return short(addr);
}

function labelsFor(
  r: { addr: string; role: WalletRole; pct: number },
  deployer?: string,
): string[] {
  const out: string[] = [];
  if (r.addr === deployer) out.push("Deployer");
  if (r.role === "liquidity") out.push("Liquidity");
  if (r.role === "burn") out.push("Burn");
  if (r.pct >= 5) out.push("Mega whale");
  else if (r.pct >= 1) out.push("Whale");
  return out;
}

function short(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function detectWalletClusters(
  transfers: RawTransfer[],
  excluded: ReadonlySet<string>,
  rows: ClusterRow[],
  deployer?: string,
  scanBlocks = SCAN_BLOCKS,
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
    const pctSupply = clusterWallets.reduce(
      (sum, wallet) => sum + (pctByWallet.get(wallet) ?? 0),
      0,
    );
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

export interface ScoreInput {
  topWalletPct: number;
  top10Pct: number;
  developerPct: number;
  liquidityPct: number;
  clusterCount: number;
  clusterPct: number;
  uniqueObserved: number;
  transferCount: number;
}

export function computeHoodScore(x: ScoreInput): HoodScore {
  let score = 100;
  const contribs: { label: string; kind: "good" | "warn" | "bad"; detail?: string }[] = [];

  // Top wallet concentration
  if (x.topWalletPct > 25) {
    score -= 22;
    contribs.push({
      label: `Largest wallet holds ${x.topWalletPct.toFixed(1)}%`,
      kind: "bad",
      detail: "Extreme single-wallet concentration.",
    });
  } else if (x.topWalletPct > 12) {
    score -= 12;
    contribs.push({ label: `Largest wallet holds ${x.topWalletPct.toFixed(1)}%`, kind: "warn" });
  } else {
    contribs.push({ label: `Largest wallet ${x.topWalletPct.toFixed(1)}%`, kind: "good" });
  }

  // Top 10 concentration
  if (x.top10Pct > 70) {
    score -= 16;
    contribs.push({ label: `Top 10 hold ${x.top10Pct.toFixed(1)}%`, kind: "bad" });
  } else if (x.top10Pct > 45) {
    score -= 8;
    contribs.push({ label: `Top 10 hold ${x.top10Pct.toFixed(1)}%`, kind: "warn" });
  } else contribs.push({ label: `Top 10 hold ${x.top10Pct.toFixed(1)}%`, kind: "good" });

  // Developer share
  if (x.developerPct > 10) {
    score -= 12;
    contribs.push({ label: `Deployer holds ${x.developerPct.toFixed(1)}%`, kind: "bad" });
  } else if (x.developerPct > 3) {
    score -= 6;
    contribs.push({ label: `Deployer holds ${x.developerPct.toFixed(1)}%`, kind: "warn" });
  } else contribs.push({ label: `Deployer share ${x.developerPct.toFixed(1)}%`, kind: "good" });

  // Cluster pressure
  if (x.clusterPct > 20) {
    score -= 15;
    contribs.push({ label: `Connected clusters hold ${x.clusterPct.toFixed(1)}%`, kind: "bad" });
  } else if (x.clusterPct > 8) {
    score -= 7;
    contribs.push({ label: `Connected clusters hold ${x.clusterPct.toFixed(1)}%`, kind: "warn" });
  } else if (x.clusterCount > 0)
    contribs.push({
      label: `${x.clusterCount} cluster(s), ${x.clusterPct.toFixed(1)}%`,
      kind: "good",
    });
  else contribs.push({ label: "No connected clusters detected", kind: "good" });

  // Liquidity presence
  if (x.liquidityPct <= 0) {
    score -= 8;
    contribs.push({ label: "No on-chain liquidity pool detected", kind: "warn" });
  } else contribs.push({ label: `Liquidity pool ${x.liquidityPct.toFixed(1)}%`, kind: "good" });

  // Activity
  if (x.transferCount < 10) {
    score -= 6;
    contribs.push({ label: `Only ${x.transferCount} transfers in window`, kind: "warn" });
  } else contribs.push({ label: `${x.transferCount} transfers observed`, kind: "good" });

  score = Math.max(5, Math.min(100, Math.round(score)));
  const grade: HoodScore["grade"] =
    score >= 85 ? "A" : score >= 70 ? "B" : score >= 55 ? "C" : score >= 40 ? "D" : "F";
  const category =
    score >= 85
      ? "Healthy distribution"
      : score >= 70
        ? "Mostly balanced"
        : score >= 55
          ? "Elevated concentration"
          : score >= 40
            ? "High risk"
            : "Severe risk";
  const reasonParts: string[] = [];
  reasonParts.push(`Top wallet ${x.topWalletPct.toFixed(1)}%, top 10 ${x.top10Pct.toFixed(1)}%`);
  if (x.developerPct > 0) reasonParts.push(`deployer ${x.developerPct.toFixed(1)}%`);
  if (x.clusterCount > 0)
    reasonParts.push(
      `${x.clusterCount} connected cluster(s) totalling ${x.clusterPct.toFixed(1)}%`,
    );
  reasonParts.push(
    `${x.uniqueObserved} unique addresses across ${x.transferCount} transfers in window`,
  );
  return { score, grade, category, reason: reasonParts.join(" · "), signals: contribs };
}

function computeHealth(x: ScoreInput & { devActive: boolean }): HealthMetric[] {
  const status = (bad: boolean, warn: boolean): HealthMetric["status"] =>
    bad ? "risk" : warn ? "moderate" : "good";
  return [
    {
      key: "distribution",
      label: "Distribution quality",
      status: status(x.top10Pct > 70, x.top10Pct > 45),
      detail: `Top 10 wallets hold ${x.top10Pct.toFixed(1)}% of the observed supply.`,
    },
    {
      key: "concentration",
      label: "Wallet concentration",
      status: status(x.topWalletPct > 25, x.topWalletPct > 12),
      detail: `Largest single wallet holds ${x.topWalletPct.toFixed(1)}%.`,
    },
    {
      key: "cluster",
      label: "Cluster risk",
      status: status(x.clusterPct > 20, x.clusterPct > 8),
      detail:
        x.clusterCount === 0
          ? "No connected wallet clusters detected in the scan window."
          : `${x.clusterCount} cluster(s) holding ${x.clusterPct.toFixed(1)}%.`,
    },
    {
      key: "developer",
      label: "Developer activity",
      status: x.developerPct > 10 || x.devActive ? "moderate" : "good",
      detail:
        x.developerPct > 0
          ? `Deployer holds ${x.developerPct.toFixed(1)}% and is ${x.devActive ? "active" : "inactive"} in the scan window.`
          : "Deployer holds no observed supply in the scan window.",
    },
    {
      key: "liquidity",
      label: "Liquidity health",
      status: x.liquidityPct > 0 ? "good" : "moderate",
      detail:
        x.liquidityPct > 0
          ? `${x.liquidityPct.toFixed(1)}% of supply sits in liquidity-like addresses.`
          : "No liquidity-like address detected in the scan window.",
    },
    {
      key: "activity",
      label: "Transaction activity",
      status: status(x.transferCount < 5, x.transferCount < 25),
      detail: `${x.transferCount} transfers across ${x.uniqueObserved} unique addresses in scan window.`,
    },
  ];
}

function smartWarnings(x: {
  top10Pct: number;
  developerPct: number;
  clusterCount: number;
  clusterPct: number;
  latestTransfers: Transfer[];
  totalSupply: number;
}): AnalysisWarning[] {
  const out: AnalysisWarning[] = [];
  if (x.top10Pct > 70)
    out.push({
      severity: "high",
      message: `Large holder concentration observed: top 10 wallets control ${x.top10Pct.toFixed(1)}% of supply.`,
    });
  else if (x.top10Pct > 45)
    out.push({
      severity: "warn",
      message: `Elevated concentration: top 10 wallets hold ${x.top10Pct.toFixed(1)}%.`,
    });
  if (x.clusterPct > 15)
    out.push({
      severity: "high",
      message: `${x.clusterCount} connected wallet cluster(s) hold ${x.clusterPct.toFixed(1)}% of supply.`,
    });
  else if (x.clusterCount > 0)
    out.push({
      severity: "info",
      message: `${x.clusterCount} connected wallet cluster(s) detected (${x.clusterPct.toFixed(1)}%).`,
    });
  if (x.developerPct > 10)
    out.push({
      severity: "warn",
      message: `Deployer still holds ${x.developerPct.toFixed(1)}% of supply.`,
    });
  // Large recent transfer detection
  const big = x.latestTransfers.find((t) => x.totalSupply > 0 && t.amount / x.totalSupply > 0.01);
  if (big)
    out.push({
      severity: "info",
      message: `Large recent transfer detected: ${((big.amount / x.totalSupply) * 100).toFixed(2)}% of supply moved.`,
    });
  return out;
}

function buildSummary(x: {
  symbol: string;
  uniqueObserved: number;
  transferCount: number;
  topWalletPct: number;
  top10Pct: number;
  developerPct: number;
  liquidityPct: number;
  clusterCount: number;
  clusterPct: number;
  devActive: boolean;
  scanBlocks: number;
}): string {
  if (x.transferCount === 0) {
    return `No transfer activity was observed for ${x.symbol} in the last ${x.scanBlocks} blocks on Robinhood Chain. Holder and cluster analysis cannot be produced without on-chain activity in the scan window.`;
  }
  const conc =
    x.top10Pct > 70
      ? "highly concentrated"
      : x.top10Pct > 45
        ? "moderately concentrated"
        : "well distributed";
  const clusterPart =
    x.clusterCount === 0
      ? "No connected wallet clusters were identified."
      : `${x.clusterCount} connected wallet cluster${x.clusterCount === 1 ? "" : "s"} were identified, holding ${x.clusterPct.toFixed(1)}% of the observed supply.`;
  const devPart =
    x.developerPct > 0
      ? `The deployer wallet holds ${x.developerPct.toFixed(1)}% of supply and is ${x.devActive ? "active" : "inactive"} during the observation window.`
      : "The deployer wallet holds no observed supply in the current window.";
  const liqPart =
    x.liquidityPct > 0
      ? `Liquidity-like address(es) hold ${x.liquidityPct.toFixed(1)}% of supply.`
      : "No liquidity-like address was detected in the scan window.";
  return `Based on ${x.transferCount} on-chain transfers across ${x.uniqueObserved} unique addresses in the last ${x.scanBlocks} blocks, ${x.symbol} holdings appear ${conc} — the largest wallet controls ${x.topWalletPct.toFixed(1)}% and the top 10 hold ${x.top10Pct.toFixed(1)}%. ${clusterPart} ${devPart} ${liqPart} This is an observational summary of blockchain data and does not constitute financial advice.`;
}
