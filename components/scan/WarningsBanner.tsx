import { AlertTriangle } from "lucide-react";
import type { AnalysisWarning } from "@/lib/scan/types";
import { cn } from "@/lib/utils";

const SEVERITY_STYLE: Record<AnalysisWarning["severity"], string> = {
  info: "border-line bg-white/[0.03] text-ink-muted",
  warn: "border-warning/30 bg-warning/10 text-warning",
  high: "border-danger/30 bg-danger/10 text-danger",
};

export function WarningsBanner({ warnings }: { warnings: AnalysisWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      {warnings.map((w, i) => (
        <div
          key={i}
          className={cn(
            "flex items-start gap-2 rounded-xl border px-3 py-2 text-xs",
            SEVERITY_STYLE[w.severity],
          )}
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {w.message}
        </div>
      ))}
    </div>
  );
}
