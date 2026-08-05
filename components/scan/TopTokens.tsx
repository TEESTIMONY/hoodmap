"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Check, Copy, RefreshCw, TrendingUp } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { discoverTrendingTokensServer } from "@/lib/scan/actions";
import { fetchDexScreenerToken, type DexPairData } from "@/lib/scan/dexscreener";
import type { TrendingToken } from "@/lib/scan/discover.server";
import { shortNumber } from "@/lib/scan/adapter";
import { formatCompactAge } from "@/lib/scan/format";
import { formatCompactNumber, shortAddress, cn } from "@/lib/utils";

interface Row extends TrendingToken {
  dex: DexPairData | null;
}

// DexScreener enrichment is called directly from the browser, one request
// per token (see the earlier "is this safe" note — no secrets involved,
// just DexScreener's own public rate limits). Firing all of them in a
// single Promise.all is fine at 20 tokens; at up to 100 it's worth
// batching so a full-page load doesn't send 100 simultaneous requests.
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
      const tokens = await discoverTrendingTokensServer(limit);
      setRows(tokens.map((t) => ({ ...t, dex: null })));
      setLoading(false);
      setEnriching(true);

      const enriched: Row[] = [];
      for (let i = 0; i < tokens.length; i += ENRICH_CONCURRENCY) {
        const slice = tokens.slice(i, i + ENRICH_CONCURRENCY);
        const dexResults = await Promise.all(
          slice.map((t) => fetchDexScreenerToken(t.address).catch(() => null)),
        );
        slice.forEach((t, idx) => enriched.push({ ...t, dex: dexResults[idx] }));
        setRows([...enriched, ...tokens.slice(i + ENRICH_CONCURRENCY).map((t) => ({ ...t, dex: null }))]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trending tokens.");
      setLoading(false);
    } finally {
      setEnriching(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [limit]);

  return (
    <GlassPanel className="overflow-hidden rounded-lg">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        {showHeader && (
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <TrendingUp className="h-4 w-4 text-lime-soft" />
            Top tokens on Robinhood Chain
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
        <div className="flex flex-col gap-2 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-lg bg-white/[0.03]" />
          ))}
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
                <th className="px-2 py-2 text-right font-medium">24h Vol</th>
                <th className="px-2 py-2 text-right font-medium">1h</th>
                <th className="px-2 py-2 text-right font-medium">6h</th>
                <th className="px-2 py-2 text-right font-medium">24h</th>
                <th className="px-2 py-2 text-right font-medium" title="Unique wallets observed on-chain in the scan window">
                  Traders
                </th>
                <th className="px-4 py-2 text-right font-medium">Age</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
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
                        <Avatar seed={r.address} name={r.symbol || r.address} size="sm" ring={false} />
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
                    {formatCompactNumber(r.uniqueTraders)}
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
          Ranked by unique wallets observed transacting on-chain in the last ~800 blocks — read
          directly from Robinhood Chain, not an index. Price, market cap, liquidity and % change
          come from DexScreener where a pair exists; shown as "—" otherwise.
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
