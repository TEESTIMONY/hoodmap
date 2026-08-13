import { GlassPanel } from "@/components/ui/GlassPanel";
import type { HealthMetric } from "@/lib/scan/types";
import { cn } from "@/lib/utils";

const STATUS_DOT: Record<HealthMetric["status"], string> = {
  excellent: "bg-success",
  good: "bg-success",
  moderate: "bg-warning",
  risk: "bg-danger",
  unknown: "bg-ink-faint",
};

// `dense` renders the same metrics as one tight single-column card (status
// dot + label + detail per row, no per-metric border/box) instead of a
// spaced 2-column grid of individually-bordered cards — for the sidebar,
// where the column is ~280px wide and metric detail sentences are full
// sentences, not short numbers, so 2-up would wrap badly.
export function HealthGrid({ metrics, dense = false }: { metrics: HealthMetric[]; dense?: boolean }) {
  if (dense) {
    return (
      <GlassPanel className="p-4">
        <div className="mb-3 text-sm font-medium text-ink">Health breakdown</div>
        <div className="flex flex-col gap-2.5">
          {metrics.map((m) => (
            <div key={m.key} className="flex items-start gap-2">
              <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[m.status])} />
              <div className="min-w-0">
                <div className="text-xs font-medium text-ink">{m.label}</div>
                <p className="mt-0.5 text-[11px] leading-snug text-ink-faint">{m.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </GlassPanel>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {metrics.map((m) => (
        <GlassPanel key={m.key} className="p-3.5">
          <div className="flex items-center gap-2">
            <span className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[m.status])} />
            <span className="text-sm font-medium text-ink">{m.label}</span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-faint">{m.detail}</p>
        </GlassPanel>
      ))}
    </div>
  );
}
