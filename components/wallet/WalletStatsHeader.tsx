import { ArrowDownRight, ArrowUpRight, ChevronDown } from "lucide-react";
import { CopyAddress } from "@/components/profile/CopyAddress";
import { StatCard } from "@/components/ui/GlassPanel";
import type { WalletPnlSummary } from "@/lib/scan/wallet-types";
import { shortNumber } from "@/lib/scan/adapter";
import { formatCompactAge } from "@/lib/scan/format";
import { cn } from "@/lib/utils";

export function WalletStatsHeader({
  summary,
  transfersExpanded,
  onToggleTransfers,
}: {
  summary: WalletPnlSummary;
  transfersExpanded: boolean;
  onToggleTransfers: () => void;
}) {
  const hasPnl = summary.realizedPnlUsd != null;
  const pnlPositive = (summary.realizedPnlUsd ?? 0) >= 0;
  const quoteBreakdown = summary.pnlByQuote
    .filter((q) => q.tradeCount > 0)
    .map((q) => `${q.realizedPnlQuote >= 0 ? "+" : ""}${shortNumber(q.realizedPnlQuote)} ${q.quoteToken.symbol}`)
    .join(" · ");

  return (
    <div className="animate-fade-up">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-ink">Wallet Passport</h1>
        <CopyAddress address={summary.address} />
      </div>
      <p className="mt-1 text-xs text-ink-faint">
        {summary.totalTransfersScanned} total transfer{summary.totalTransfersScanned === 1 ? "" : "s"}{" "}
        found · {summary.totalTrades} priced as trade{summary.totalTrades === 1 ? "" : "s"} (paired
        swaps against an auto-detected reference asset) · scan window{" "}
        {summary.dataSources.scanFromBlock.toLocaleString()}–
        {summary.dataSources.scanToBlock.toLocaleString()}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        <button
          onClick={onToggleTransfers}
          aria-expanded={transfersExpanded}
          className="glass-panel flex items-center justify-between rounded-xl px-4 py-3 text-left transition hover:border-line-strong"
        >
          <div>
            <div className="text-lg font-semibold text-ink">{summary.totalTransfersScanned}</div>
            <div className="text-xs text-ink-faint">Total transfers</div>
          </div>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-ink-faint transition-transform",
              transfersExpanded && "rotate-180",
            )}
          />
        </button>
        <StatCard label="Total trades" value={String(summary.totalTrades)} />
        <StatCard
          label="Win rate"
          value={summary.totalTrades > 0 ? `${summary.winRate.toFixed(0)}%` : "—"}
        />
        <StatCard label="Avg hold time" value={formatCompactAge(summary.avgHoldSeconds)} />
        <div className="glass-panel rounded-xl px-4 py-3">
          <div
            className={cn(
              "flex items-center gap-1 text-lg font-semibold",
              !hasPnl ? "text-ink" : pnlPositive ? "text-success" : "text-danger",
            )}
          >
            {hasPnl &&
              (pnlPositive ? (
                <ArrowUpRight className="h-4 w-4" />
              ) : (
                <ArrowDownRight className="h-4 w-4" />
              ))}
            {hasPnl ? `${pnlPositive ? "+" : ""}$${shortNumber(Math.abs(summary.realizedPnlUsd!))}` : "—"}
          </div>
          <div className="truncate text-xs text-ink-faint" title={quoteBreakdown || undefined}>
            Realized PnL{quoteBreakdown && ` · ${quoteBreakdown}`}
          </div>
        </div>
      </div>
    </div>
  );
}
