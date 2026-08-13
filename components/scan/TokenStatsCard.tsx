import { AtSign, Globe, Hash, Link as LinkIcon, Send } from "lucide-react";
import { GlassPanel } from "@/components/ui/GlassPanel";
import type { TokenMeta } from "@/lib/scan/types";
import { shortNumber } from "@/lib/scan/adapter";
import { cn } from "@/lib/utils";

// DexScreener doesn't have a brand icon for every social platform (and
// lucide-react dropped brand-specific icons entirely), so this maps to the
// closest generic shape rather than a wrong or missing one.
const SOCIAL_ICON: Record<string, typeof Globe> = {
  twitter: AtSign,
  x: AtSign,
  telegram: Send,
  discord: Hash,
};

function StatTile({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-[8px] bg-white/[0.03] px-2.5 py-2">
      <div className={cn("text-xs font-semibold text-ink", valueClass)}>{value}</div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-ink-faint">{label}</div>
    </div>
  );
}

function ChangeTile({ label, pct }: { label: string; pct?: number }) {
  return (
    <div className="rounded-[8px] bg-white/[0.03] px-1.5 py-2 text-center">
      <div
        className={cn(
          "text-xs font-semibold",
          pct == null ? "text-ink-faint" : pct >= 0 ? "text-success" : "text-danger",
        )}
      >
        {pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%` : "—"}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wide text-ink-faint">{label}</div>
    </div>
  );
}

export function TokenStatsCard({ token, poolLabel }: { token: TokenMeta; poolLabel?: string }) {
  const socials = token.socials ?? [];
  const hasLinks = !!token.websiteUrl || socials.length > 0;
  const windows = token.priceChangeWindows;
  const txns24h = token.txnsWindows?.h24 ?? token.txns24h;

  return (
    <GlassPanel className="p-4">
      <div className="mb-1 text-sm font-medium text-ink">Market stats</div>
      <p className="mb-3 text-[11px] text-ink-faint">{poolLabel ?? "From DexScreener's best-liquidity pair for this token."}</p>

      {hasLinks && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {token.websiteUrl && (
            <a
              href={token.websiteUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Website"
              className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-white/[0.04] text-ink-faint transition hover:bg-white/[0.08] hover:text-ink"
            >
              <Globe className="h-3.5 w-3.5" />
            </a>
          )}
          {socials.map((s) => {
            const Icon = SOCIAL_ICON[s.type.toLowerCase()] ?? LinkIcon;
            return (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={s.type}
                className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-white/[0.04] text-ink-faint transition hover:bg-white/[0.08] hover:text-ink"
              >
                <Icon className="h-3.5 w-3.5" />
              </a>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        <StatTile label="Price USD" value={token.priceUsd != null ? `$${shortNumber(token.priceUsd)}` : "—"} />
        <StatTile
          label="Price"
          value={token.priceNative != null ? `${shortNumber(token.priceNative)} ${token.quoteSymbol ?? ""}` : "—"}
        />
      </div>

      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        <StatTile label="Liquidity" value={token.liquidityUsd != null ? `$${shortNumber(token.liquidityUsd)}` : "—"} />
        <StatTile label="FDV" value={token.fdvUsd != null ? `$${shortNumber(token.fdvUsd)}` : "—"} />
        <StatTile label="Mkt cap" value={token.marketCapUsd != null ? `$${shortNumber(token.marketCapUsd)}` : "—"} />
      </div>

      <div className="mt-1.5 grid grid-cols-4 gap-1.5">
        <ChangeTile label="5m" pct={windows?.m5} />
        <ChangeTile label="1h" pct={windows?.h1} />
        <ChangeTile label="6h" pct={windows?.h6} />
        <ChangeTile label="24h" pct={windows?.h24} />
      </div>

      <div className="mt-1.5 grid grid-cols-3 gap-1.5">
        <StatTile
          label="Volume 24h"
          value={token.volume24hUsd != null ? `$${shortNumber(token.volume24hUsd)}` : "—"}
        />
        <StatTile
          label="Buys 24h"
          value={txns24h ? String(txns24h.buys) : "—"}
          valueClass="text-success"
        />
        <StatTile
          label="Sells 24h"
          value={txns24h ? String(txns24h.sells) : "—"}
          valueClass="text-danger"
        />
      </div>
    </GlassPanel>
  );
}
