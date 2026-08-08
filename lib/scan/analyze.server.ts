// Live analysis pipeline for Robinhood Chain tokens, ported from HoodMap.
// Orchestrates: metadata → transfer logs → holder balances → clusters →
// score → grounded summary. Server-only.

import { formatUnits, getAddress } from "viem";
import {
  batchBlockTimestamps,
  batchNativeBalance,
  estimateContractAgeSeconds,
  getLatestBlockNumber,
  isBurnAddress,
  publicClient,
  RPC_URL,
  ZERO_ADDRESS,
  type RawTransfer,
} from "./rpc.server";
import { fetchTransferLogsHybrid } from "@/lib/indexer/hybrid-transfers";
import { detectWalletClustersHybrid } from "@/lib/indexer/hybrid-clusters";
import { resolveBalancesHybrid } from "@/lib/indexer/hybrid-balances";
import { resolveMetadataHybrid } from "@/lib/indexer/hybrid-metadata";
import { short, type ClusterRow } from "./clusters";
import { selectCandidateHolders } from "./candidates";
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

// Scan window: last ~50,000 blocks (~1.15 days at ~2s block time) — wider
// than the original 5,000-block (~3hr) window that missed real clusters
// visible over a token's fuller history (confirmed against Bubblemaps),
// but deliberately NOT the 500,000-block window tried first. That version
// caused real production 500s on Vercel: even before counting per-transfer
// processing, ~556 chunks at 900 blocks/chunk (~93 sequential rounds at
// this file's chunk concurrency) plausibly took 45-90+ seconds just to
// fetch, regardless of how active the token was — well past a serverless
// function's default execution limit. This is a smaller, safer step in
// the same direction, not the ceiling; revisit once maxDuration (set on
// the pages that call this) and real timing on the actual deployment
// target are both confirmed, not just measured in local testing.
const SCAN_BLOCKS = 50_000n;
// How many observed addresses to resolve to real balances via balanceOf.
// 100 so HoodMap can render up to the top 100 holders (see step 8 below).
const HOLDERS_TO_RESOLVE = 100;
// Latest N transfers to show in the recent-transfers panel.
const RECENT_TRANSFERS = 25;

export async function analyzeTokenLive(rawAddress: string): Promise<AnalysisResult> {
  const address = getAddress(rawAddress);
  const now = new Date().toISOString();
  const warnings: AnalysisWarning[] = [];

  // ── 1. Metadata + head block, in parallel
  // resolveMetadataHybrid reads a cached row (see lib/indexer/snapshot.ts,
  // the background job that maintains it) when one exists, live otherwise —
  // metadata rarely changes post-deploy, so a cached row is used as-is with
  // no extra freshness check. Falls back to the exact previous live-only
  // behavior whenever DATABASE_URL is unset or the DB errors.
  const [{ meta, source: metaSource }, latestBlock] = await Promise.all([
    resolveMetadataHybrid(address),
    getLatestBlockNumber(),
  ]);

  const fromBlock = latestBlock > SCAN_BLOCKS ? latestBlock - SCAN_BLOCKS : 0n;

  // ── 2. Transfer logs across window (+ contract-age estimate in parallel)
  // Bounds more than just the log-fetch itself: every transfer collected
  // here also needs a block-timestamp lookup downstream (batchBlockTimestamps,
  // one eth_getBlock per unique block, 20 at a time) plus cluster-detection
  // processing — that downstream cost, not the log fetch, was the main
  // reason the original 25,000 cap (harmless at the old 5,000-block window)
  // caused a scan to run past 5 minutes once the window widened. 3,000
  // stays close to the ~1,330-transfer real case that was already known to
  // run in seconds, with headroom, rather than assuming a bigger number is
  // safe without measuring it again.
  const MAX_TRANSFER_LOGS = 3_000;
  // fetchTransferLogsHybrid tries the indexed Postgres database first (real
  // history, not bounded to SCAN_BLOCKS) plus a live-RPC "tail" for
  // whatever's happened since the indexer's last sync, falling back to the
  // exact previous live-RPC-only behavior whenever the DB has nothing for
  // this token yet (not indexed, DATABASE_URL unset, or a DB error) — see
  // lib/indexer/hybrid-transfers.ts for the full reasoning and live
  // verification. This can only ever match or beat the old bounded-window
  // result, never regress it: the tail fetch is capped to never exceed
  // SCAN_BLOCKS of live-RPC work even if the indexer has fallen behind.
  const [{ transfers, source: transferSource }, ageSeconds] = await Promise.all([
    fetchTransferLogsHybrid(address, fromBlock, latestBlock, MAX_TRANSFER_LOGS),
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
  const { candidates, activity, deployer } = selectCandidateHolders(transfers, HOLDERS_TO_RESOLVE);

  // resolveBalancesHybrid reads whatever the background snapshot job (see
  // lib/indexer/snapshot.ts) already has for this token, live RPC only for
  // whichever candidates it doesn't cover — see that module's comment for
  // why this carries none of the correctness risk balance materialization
  // from summed transfer deltas would have (every value here, DB or live,
  // came from a real balanceOf call, just possibly up to one snapshot cycle
  // stale). Also auto-registers the token for future snapshots.
  const {
    balances,
    failed: balanceFetchFailed,
    source: balanceSource,
  } = candidates.length
    ? await resolveBalancesHybrid(address, candidates)
    : { balances: new Map<string, bigint>(), failed: [] as string[], source: "rpc-only" as const };
  // A candidate whose balance couldn't be resolved even after retry must NOT
  // fall back to "0 tokens" — under real RPC load that's indistinguishable
  // from a genuine empty wallet and was confirmed live to fabricate fake
  // "0.00%" whale rows for wallets that actually hold a meaningful stake
  // (see the batchBalanceOf comment). Excluded from holder rows entirely,
  // same as a strict metadata-read failure elsewhere in this codebase.
  const balanceFetchFailedSet = new Set(balanceFetchFailed);
  if (balanceFetchFailedSet.size > 0) {
    warnings.push({
      severity: "info",
      message: `${balanceFetchFailedSet.size} wallet balance(s) couldn't be read from Robinhood Chain even after a retry (RPC instability under this much request volume) and were left out of the holder/whale data rather than shown as an inaccurate 0.`,
    });
  }

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
  const rows: Row[] = candidates
    .filter((addr) => !balanceFetchFailedSet.has(addr))
    .map((addr) => {
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
  // 1-indexed rank by raw balance, matching a block explorer's "top
  // holders" list — computed once here, right after the sort it depends
  // on, so every downstream consumer (whale table, HoodMap bubbles) reads
  // the same rank rather than each recomputing its own position.
  const rankByAddr = new Map(rows.map((r, i) => [r.addr, i + 1]));

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
  // Tries the indexed database's full history first (via wallet_funders,
  // maintained incrementally by the ingest worker — see
  // lib/indexer/hybrid-clusters.ts), falling back to the unmodified live
  // detectWalletClusters (capped to this scan's transfer window) whenever
  // the DB has nothing for this token yet.
  const { groups: topGroups, source: clusterSource } = await detectWalletClustersHybrid(
    address,
    transfers,
    excluded,
    rows,
    deployer,
    SCAN_BLOCKS,
  );

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
      rank: rankByAddr.get(addr),
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
  const { balances: nativeBalances, failed: nativeBalanceFailed } = whaleRows.length
    ? await batchNativeBalance(whaleRows.map((r) => r.addr))
    : { balances: new Map<string, bigint>(), failed: [] as string[] };
  const nativeBalanceFailedSet = new Set(nativeBalanceFailed);
  const whales: WhaleRow[] = whaleRows.map((r) => ({
    address: r.addr,
    balance: r.balance,
    pctSupply: r.pct,
    // undefined (not 0) when the fetch failed even after retry — the UI
    // shows this as "unavailable" rather than a fabricated "0.0000 ETH".
    nativeBalance: nativeBalanceFailedSet.has(r.addr)
      ? undefined
      : Number(formatUnits(nativeBalances.get(r.addr) ?? 0n, 18)),
    connectedWallets: countConnections(r.addr, edgeCount),
    recentTxs: r.activity,
    rank: rankByAddr.get(r.addr),
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
      provider: transferSource === "db+rpc-tail" ? "Robinhood Chain RPC + indexed history" : "Robinhood Chain RPC",
      rpcUrl: RPC_URL,
      // When the indexed database contributed, the transfers actually
      // scanned can reach further back than the nominal SCAN_BLOCKS
      // window — transfers[0] (ascending order) is the true oldest block
      // reached, honest either way rather than always reporting the
      // nominal window regardless of what was actually used.
      observationWindowBlocks:
        transferSource === "db+rpc-tail" && transfers.length > 0
          ? Number(latestBlock - transfers[0].blockNumber)
          : Number(SCAN_BLOCKS),
      observationWindowFromBlock: transfers.length > 0 ? Number(transfers[0].blockNumber) : Number(fromBlock),
      observationWindowToBlock: Number(latestBlock),
      lastUpdated: now,
      notes: [
        transferSource === "db+rpc-tail"
          ? `Holders and clusters are derived from Transfer events in blocks ${transfers[0]?.blockNumber.toString() ?? fromBlock.toString()}–${latestBlock.toString()} (indexed history plus live recent activity) plus balanceOf reads.`
          : `Holders and clusters are derived from Transfer events in blocks ${fromBlock.toString()}–${latestBlock.toString()} plus balanceOf reads.`,
        clusterSource === "db"
          ? "Cluster detection uses the indexed database's full history for this token, not just the current scan window."
          : "Cluster detection observes only the scan window.",
        // Every holder balance, DB-sourced or live, came from a real
        // balanceOf call at some point — a DB-sourced one just isn't
        // necessarily from THIS request, so it can lag live by up to one
        // background-snapshot cycle. Said explicitly rather than letting
        // "Balances are exact (balanceOf)" imply real-time when it isn't.
        balanceSource === "db"
          ? "Holder balances are from the background snapshot job's cached balanceOf reads for this token — accurate as of the last snapshot, not necessarily this instant."
          : balanceSource === "db+rpc-partial"
            ? "Holder balances are a mix of the background snapshot job's cached balanceOf reads and live balanceOf reads for wallets the snapshot doesn't cover yet."
            : "Holder balances were read live via balanceOf for this request.",
        metaSource === "db"
          ? "Token metadata (name/symbol/decimals/totalSupply) is a cached read, refreshed periodically rather than for this request."
          : "Token metadata was read live from the contract for this request.",
      ],
    },
    whales,
    health,
    warnings,
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

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
