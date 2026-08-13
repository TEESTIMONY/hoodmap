import { CopyAddress } from "@/components/profile/CopyAddress";
import { Avatar } from "@/components/ui/Avatar";
import { GlassPanel } from "@/components/ui/GlassPanel";
import type { TokenMeta } from "@/lib/scan/types";

function formatAgo(seconds?: number): string {
  if (seconds == null) return "Unknown age";
  const days = Math.floor(seconds / 86400);
  if (days > 0) return `${days}d old`;
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return `${hours}h old`;
  return `${Math.floor(seconds / 60)}m old`;
}

// The Price/Market cap/Liquidity/24h change stat row that used to live here
// moved into the sidebar's TokenStatsCard, alongside the richer DexScreener
// data (FDV, 5m/1h/6h windows, buys/sells) it didn't have room for as a
// 4-box row — this is now just identity: avatar, name, age, address.
//
// `compact` renders the same identity fields as their own small card,
// sized for the sidebar column — sits above TokenStatsCard there the same
// way this full version sits above the chart, so the sidebar reads as a
// self-contained unit rather than depending on scrolling back up to the
// page-level header to know which token it's even showing.
export function TokenHeader({ token, compact = false }: { token: TokenMeta; compact?: boolean }) {
  if (compact) {
    return (
      <GlassPanel className="p-4 animate-fade-up">
        <div className="flex items-start gap-2.5">
          <Avatar seed={token.address} name={token.symbol || token.name} size="sm" ring={false} imageUrl={token.imageUrl} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-ink">
              {token.name} <span className="text-ink-faint">({token.symbol})</span>
            </div>
            <div className="mt-0.5 text-[11px] text-ink-faint">{formatAgo(token.createdAgoSeconds)}</div>
            <div className="mt-1.5 flex items-center gap-2">
              <CopyAddress address={token.address} />
              {token.dexUrl && (
                <a
                  href={token.dexUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-moss-soft hover:underline"
                >
                  View chart
                </a>
              )}
            </div>
          </div>
        </div>
      </GlassPanel>
    );
  }

  return (
    <div className="flex items-start gap-3 animate-fade-up">
      <Avatar seed={token.address} name={token.symbol || token.name} size="lg" ring={false} imageUrl={token.imageUrl} />
      <div className="min-w-0 flex-1">
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
      </div>
    </div>
  );
}
