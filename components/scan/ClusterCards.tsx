import { GlassPanel } from "@/components/ui/GlassPanel";
import type { WalletGroup } from "@/lib/scan/types";
import { cn } from "@/lib/utils";

const RISK_STYLE: Record<WalletGroup["risk"], string> = {
  low: "text-success border-success/30 bg-success/10",
  medium: "text-warning border-warning/30 bg-warning/10",
  high: "text-danger border-danger/30 bg-danger/10",
};

export function ClusterCards({ groups }: { groups: WalletGroup[] }) {
  return (
    <GlassPanel className="p-4">
      <div className="mb-3 text-sm font-medium text-ink">Wallet clusters</div>
      {groups.length === 0 ? (
        <p className="text-xs text-ink-faint">No connected wallet clusters detected in this window.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((g) => (
            <div key={g.id} className="rounded-[8px] border border-line bg-white/[0.03] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm text-ink">{g.label}</span>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                    RISK_STYLE[g.risk],
                  )}
                >
                  {g.risk} risk · {g.pctSupply.toFixed(1)}%
                </span>
              </div>
              <p className="mt-1.5 text-xs text-ink-faint">{g.note}</p>
              <p className="mt-1 text-[11px] text-ink-faint/80">{g.reason}</p>
              <p className="mt-1.5 text-[11px] text-ink-faint">{g.wallets.length} wallets</p>
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
