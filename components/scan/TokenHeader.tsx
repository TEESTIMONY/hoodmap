import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { CopyAddress } from "@/components/profile/CopyAddress";
import { StatCard } from "@/components/ui/GlassPanel";
import type { TokenMeta } from "@/lib/scan/types";
import { shortNumber } from "@/lib/scan/adapter";
import { cn } from "@/lib/utils";

function formatAgo(seconds?: number): string {
  if (seconds == null) return "Unknown age";
  const days = Math.floor(seconds / 86400);
  if (days > 0) return `${days}d old`;
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return `${hours}h old`;
  return `${Math.floor(seconds / 60)}m old`;
}

export function TokenHeader({ token }: { token: TokenMeta }) {
  const change = token.priceChange24h;

  return (
    <div className="animate-fade-up">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-ink">
          {token.name} <span className="text-ink-faint">({token.symbol})</span>
        </h1>
        <span className="rounded-full border border-line bg-white/[0.04] px-2 py-0.5 text-[11px] text-ink-faint">
          {formatAgo(token.createdAgoSeconds)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <CopyAddress address={token.address} />
        {token.dexUrl && (
          <a
            href={token.dexUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-moss-soft hover:underline"
          >
            View chart
          </a>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatCard label="Price" value={token.priceUsd != null ? `$${shortNumber(token.priceUsd)}` : "—"} />
        <StatCard
          label="Market cap"
          value={token.marketCapUsd != null ? `$${shortNumber(token.marketCapUsd)}` : "—"}
        />
        <StatCard
          label="Liquidity"
          value={token.liquidityUsd != null ? `$${shortNumber(token.liquidityUsd)}` : "—"}
        />
        <div className="glass-panel rounded-xl px-4 py-3">
          <div
            className={cn(
              "flex items-center gap-1 text-lg font-semibold",
              change == null ? "text-ink" : change >= 0 ? "text-success" : "text-danger",
            )}
          >
            {change != null &&
              (change >= 0 ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />)}
            {change != null ? `${Math.abs(change).toFixed(1)}%` : "—"}
          </div>
          <div className="text-xs text-ink-faint">24h change</div>
        </div>
      </div>
    </div>
  );
}
