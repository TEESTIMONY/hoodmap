import { GlassPanel } from "@/components/ui/GlassPanel";
import type { HolderBucket } from "@/lib/scan/types";

export function HolderDistribution({ buckets }: { buckets: HolderBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.pct));

  return (
    <GlassPanel className="p-4">
      <div className="mb-3 text-sm font-medium text-ink">Holder distribution</div>
      {buckets.length === 0 ? (
        <p className="text-xs text-ink-faint">No holder data observed in the scan window.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {buckets.map((b) => (
            <div key={b.label}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-ink-muted">{b.label}</span>
                <span className="text-ink-faint">{b.pct.toFixed(1)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-lime to-moss"
                  style={{ width: `${Math.max(2, (b.pct / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
