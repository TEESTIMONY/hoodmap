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

export function HealthGrid({ metrics }: { metrics: HealthMetric[] }) {
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
