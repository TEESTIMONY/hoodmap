"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, RefreshCw, TrendingUp } from "lucide-react";
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

export function TopTokens() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const tokens = await discoverTrendingTokensServer(20);
      setRows(tokens.map((t) => ({ ...t, dex: null })));
      setLoading(false);
      setEnriching(true);
      const enriched = await Promise.all(
        tokens.map(async (t) => ({
          ...t,
          dex: await fetchDexScreenerToken(t.address).catch(() => null),
        })),
      );
      setRows(enriched);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load trending tokens.");
      setLoading(false);
    } finally {
      setEnriching(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <GlassPanel className="overflow-hidden rounded-lg">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          <TrendingUp className="h-4 w-4 text-lime-soft" />
          Top tokens on Robinhood Chain
          {enriching && (
            <span className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[10px] text-ink-faint">
              pricing…
            </span>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs text-ink-faint transition hover:border-line-strong hover:text-ink-muted disabled:opacity-50"
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
                    <Link
                      href={`/scan?address=${r.address}`}
                      className="flex min-w-0 items-center gap-2.5"
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

      <div className="border-t border-line px-4 py-2.5 text-[11px] text-ink-faint">
        Ranked by unique wallets observed transacting on-chain in the last ~800 blocks — read
        directly from Robinhood Chain, not an index. Price, market cap, liquidity and % change
        come from DexScreener where a pair exists; shown as "—" otherwise.
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
