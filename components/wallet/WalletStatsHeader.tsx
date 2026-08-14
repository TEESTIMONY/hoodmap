import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { CopyAddress } from "@/components/profile/CopyAddress";
import { Avatar } from "@/components/ui/Avatar";
import { GlassPanel } from "@/components/ui/GlassPanel";
import type { WalletPnlSummary } from "@/lib/scan/wallet-types";
import { shortNumber } from "@/lib/scan/adapter";
import { formatCompactAge } from "@/lib/scan/format";
import { cn } from "@/lib/utils";

// Mirrors TokenHeader's sidebar identity card on the scan page — same
// avatar + copy-address shape, just seeded from the wallet address itself
// (there's no name/logo for a wallet the way there is for a token) instead
// of a token's image.
export function WalletIdentityCard({ summary }: { summary: WalletPnlSummary }) {
  return (
    <GlassPanel className="p-5 animate-fade-up">
      <div className="flex items-start gap-3">
        <Avatar seed={summary.address} name={summary.address} size="lg" ring={false} />
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold leading-snug text-ink">Wallet Passport</div>
          <div className="mt-1 text-xs text-ink-faint">
            {summary.totalTransfersScanned} transfer{summary.totalTransfersScanned === 1 ? "" : "s"} · scan
            window {summary.dataSources.scanFromBlock.toLocaleString()}–
            {summary.dataSources.scanToBlock.toLocaleString()}
          </div>
          <div className="mt-2">
            <CopyAddress address={summary.address} />
          </div>
        </div>
      </div>
    </GlassPanel>
  );
}

function StatTile({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-[8px] bg-white/[0.03] px-2.5 py-2">
      <div className={cn("text-xs font-semibold text-ink", valueClass)}>{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-ink-faint">{label}</div>
    </div>
  );
}

// Same StatTile-grid shape TokenStatsCard uses for the scan sidebar — this
// used to be a row of 5 full-width boxes (one of them doubling as the
// "expand transfers inline" toggle); transfers are now their own tab
// instead (see WalletScanPage), so this is just the stats, sized for a
// narrow fixed-width sidebar column rather than the page's full width.
export function WalletStatsCard({ summary }: { summary: WalletPnlSummary }) {
  const hasPnl = summary.realizedPnlUsd != null;
  const pnlPositive = (summary.realizedPnlUsd ?? 0) >= 0;
  const quoteBreakdown = summary.pnlByQuote
    .filter((q) => q.tradeCount > 0)
    .map((q) => `${q.realizedPnlQuote >= 0 ? "+" : ""}${shortNumber(q.realizedPnlQuote)} ${q.quoteToken.symbol}`)
    .join(" · ");

  return (
    <GlassPanel className="p-4">
      <div className="mb-1 text-sm font-medium text-ink">Trading stats</div>
      <p className="mb-3 text-[11px] text-ink-faint">
        {summary.totalTrades} trade{summary.totalTrades === 1 ? "" : "s"} priced against an
        auto-detected reference asset.
      </p>

      <div className="grid grid-cols-2 gap-1.5">
        <StatTile label="Total trades" value={String(summary.totalTrades)} />
        <StatTile label="Win rate" value={summary.totalTrades > 0 ? `${summary.winRate.toFixed(0)}%` : "—"} />
      </div>

      <div className="mt-1.5 grid grid-cols-2 gap-1.5">
        <StatTile label="Avg hold time" value={formatCompactAge(summary.avgHoldSeconds)} />
        <StatTile
          label="Realized PnL"
          value={hasPnl ? `${pnlPositive ? "+" : ""}$${shortNumber(Math.abs(summary.realizedPnlUsd!))}` : "—"}
          valueClass={!hasPnl ? undefined : pnlPositive ? "text-success" : "text-danger"}
        />
      </div>

      {quoteBreakdown && (
        <div className="mt-2 flex items-center gap-1 rounded-[8px] bg-white/[0.03] px-2.5 py-2 text-[11px] text-ink-faint">
          {pnlPositive ? (
            <ArrowUpRight className="h-3 w-3 shrink-0 text-success" />
          ) : (
            <ArrowDownRight className="h-3 w-3 shrink-0 text-danger" />
          )}
          <span className="truncate">{quoteBreakdown}</span>
        </div>
      )}
    </GlassPanel>
  );
}
