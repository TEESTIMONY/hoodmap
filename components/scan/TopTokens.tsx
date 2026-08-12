"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Check, Copy, RefreshCw, TrendingUp } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { BubbleLoader } from "@/components/scan/BubbleLoader";
import { discoverTrendingTokensServer, fetchDexScreenerTokenServer } from "@/lib/scan/actions";
import { friendlyErrorMessage } from "@/lib/scan/validate";
import type { DexPairData } from "@/lib/scan/dexscreener";
import type { TrendingToken } from "@/lib/scan/discover.server";
import { shortNumber } from "@/lib/scan/adapter";
import { formatCompactAge } from "@/lib/scan/format";
import { formatCompactNumber, shortAddress, cn } from "@/lib/utils";

interface Row extends TrendingToken {
  dex: DexPairData | null;
}

// DexScreener enrichment now goes through a server action (fetchDexScreenerTokenServer)
// instead of the browser calling DexScreener directly — same per-token
// batching as before, but now shared/cacheable server-side across every
// visitor instead of every browser independently hitting DexScreener.
const ENRICH_CONCURRENCY = 12;

export function TopTokens({
  showHeader = true,
  limit = 20,
  viewAllHref,
}: {
  showHeader?: boolean;
  limit?: number;
  viewAllHref?: string;
} = {}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [source, setSource] = useState<"blockscout" | "live-rpc" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [copiedAddress, setCopiedAddress] = useState<string | null>(null);

  async function handleCopy(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopiedAddress(address);
      setTimeout(() => setCopiedAddress((cur) => (cur === address ? null : cur)), 1500);
    } catch {
      // Clipboard API unavailable — nothing meaningful to recover into.
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const { tokens, source: resultSource } = await discoverTrendingTokensServer(limit);
      setSource(resultSource);
      setRows(tokens.map((t) => ({ ...t, dex: null })));
      setLoading(false);
      setEnriching(true);

      const enriched: Row[] = [];
      for (let i = 0; i < tokens.length; i += ENRICH_CONCURRENCY) {
        const slice = tokens.slice(i, i + ENRICH_CONCURRENCY);
        const dexResults = await Promise.all(
          slice.map((t) => fetchDexScreenerTokenServer(t.address).catch(() => null)),
        );
        slice.forEach((t, idx) => enriched.push({ ...t, dex: dexResults[idx] }));
        setRows([...enriched, ...tokens.slice(i + ENRICH_CONCURRENCY).map((t) => ({ ...t, dex: null }))]);
      }
    } catch (err) {
      setError(friendlyErrorMessage(err, "Couldn't load trending tokens right now. Please try again in a moment."));
      setLoading(false);
    } finally {
      setEnriching(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  // Discovery ranks by unique traders (the only signal available before
  // DexScreener enrichment, which happens after and per-token). Display
  // order is by 24h volume once that data is in — a token with no pair on
  // DexScreener yet (dex: null, still enriching or no pair exists) sorts
  // below every token with a known volume, including a real $0, rather
  // than being conflated with an actual zero.
  const sortedRows = rows
    ? [...rows].sort((a, b) => (b.dex?.volumeUsd.h24 ?? -1) - (a.dex?.volumeUsd.h24 ?? -1))
    : [];

  return (
    <GlassPanel className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        {showHeader && (
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <TrendingUp className="h-4 w-4 text-lime-soft" />
            Top memecoins on Robinhood Chain
          </div>
        )}
        {enriching && (
          <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-ink-faint">
            pricing…
          </span>
        )}
        <button
          onClick={load}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-ink-faint transition hover:border-line-strong hover:text-ink-muted disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {error && <div className="px-4 py-6 text-sm text-danger">{error}</div>}

      {!error && (loading || !rows) && (
        <div className="flex items-center justify-center py-10">
          <BubbleLoader label="Scanning Robinhood Chain for trending memecoins…" />
        </div>
      )}

      {!error && rows && rows.length === 0 && !loading && (
        <div className="px-4 py-6 text-sm text-ink-faint">
          No token activity observed in the recent scan window.
        </div>
      )}

      {!error && rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">Token</th>
                <th className="px-2 py-2 text-right font-medium">Price</th>
                <th className="px-2 py-2 text-right font-medium">Mcap</th>
                <th className="px-2 py-2 text-right font-medium">Liquidity</th>
                <th className="px-2 py-2 text-right font-medium" title="List is sorted by this column, highest first">
                  24h Vol ↓
                </th>
                <th className="px-2 py-2 text-right font-medium">1h</th>
                <th className="px-2 py-2 text-right font-medium">6h</th>
                <th className="px-2 py-2 text-right font-medium">24h</th>
                <th
                  className="px-2 py-2 text-right font-medium"
                  title={
                    source === "blockscout"
                      ? "Total token holders, from Robinhood Chain's indexer"
                      : "Unique wallets observed on-chain in the scan window"
                  }
                >
                  {source === "blockscout" ? "Holders" : "Traders"}
                </th>
                <th className="px-4 py-2 text-right font-medium">Age</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r, i) => (
                <tr
                  key={r.address}
                  className="border-b border-line/60 transition hover:bg-white/[0.02]"
                >
                  <td className="px-4 py-2.5 text-ink-faint">{i + 1}</td>
                  <td className="px-2 py-2.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Link
                        href={`/scan?address=${r.address}`}
                        className="flex min-w-0 flex-1 items-center gap-2.5"
                      >
                        <Avatar
                          seed={r.address}
                          name={r.symbol || r.address}
                          size="sm"
                          ring={false}
                          imageUrl={r.dex?.imageUrl}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate font-medium text-ink">{r.symbol}</span>
                            {r.dex?.poolLabel && (
                              <span className="shrink-0 text-[10px] text-ink-faint">
                                {r.dex.poolLabel}
                              </span>
                            )}
                          </div>
                          <div className="truncate font-mono text-[11px] text-ink-faint">
                            {r.name !== r.symbol ? r.name : shortAddress(r.address)}
                          </div>
                        </div>
                      </Link>
                      <button
                        type="button"
                        onClick={() => handleCopy(r.address)}
                        title={`Copy ${r.address}`}
                        aria-label={`Copy ${r.symbol} contract address`}
                        className="shrink-0 rounded-md p-1 text-ink-faint transition hover:bg-white/[0.06] hover:text-ink"
                      >
                        {copiedAddress === r.address ? (
                          <Check className="h-3.5 w-3.5 text-success" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-right text-ink">
                    {r.dex?.priceUsd != null ? `$${shortNumber(r.dex.priceUsd)}` : "—"}
                  </td>
                  <td className="px-2 py-2.5 text-right text-ink-muted">
                    {r.dex?.marketCapUsd != null ? `$${shortNumber(r.dex.marketCapUsd)}` : "—"}
                  </td>
                  <td className="px-2 py-2.5 text-right text-ink-muted">
                    {r.dex?.liquidityUsd != null ? `$${shortNumber(r.dex.liquidityUsd)}` : "—"}
                  </td>
                  <td className="px-2 py-2.5 text-right text-ink-muted">
                    {r.dex?.volumeUsd.h24 != null ? `$${shortNumber(r.dex.volumeUsd.h24)}` : "—"}
                  </td>
                  <PctCell value={r.dex?.priceChange.h1} />
                  <PctCell value={r.dex?.priceChange.h6} />
                  <PctCell value={r.dex?.priceChange.h24} />
                  <td className="px-2 py-2.5 text-right text-ink">
                    {formatCompactNumber(source === "blockscout" ? (r.holdersCount ?? 0) : (r.uniqueTraders ?? 0))}
                  </td>
                  <td className="px-4 py-2.5 text-right text-ink-faint">
                    {r.dex?.createdAgoSeconds != null ? formatCompactAge(r.dex.createdAgoSeconds) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[11px] text-ink-faint">
        <span>
          {source === "blockscout"
            ? "Sorted by 24h volume, highest first. Candidates are discovered from Robinhood Chain's official Blockscout indexer (24h volume + holder counts), not a live scan."
            : "Sorted by 24h volume, highest first. Candidates are discovered by unique wallets observed transacting on-chain in the last ~800 blocks — read directly from Robinhood Chain, not an index (Blockscout was unavailable for this load)."}{" "}
          Price, market cap, liquidity and % change come from DexScreener where a pair exists; shown
          as "—" otherwise, and sorted last.
        </span>
        {viewAllHref && (
          <Link href={viewAllHref} className="shrink-0 whitespace-nowrap text-lime-soft hover:underline">
            View all →
          </Link>
        )}
      </div>
    </GlassPanel>
  );
}

function PctCell({ value }: { value?: number }) {
  if (value == null) return <td className="px-2 py-2.5 text-right text-ink-faint">—</td>;
  const positive = value >= 0;
  return (
    <td
      className={cn(
        "px-2 py-2.5 text-right font-medium",
        positive ? "text-success" : "text-danger",
      )}
    >
      <span className="inline-flex items-center gap-0.5">
        {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
        {Math.abs(value).toFixed(2)}%
      </span>
    </td>
  );
}
