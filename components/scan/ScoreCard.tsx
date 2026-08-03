import { GlassPanel } from "@/components/ui/GlassPanel";
import type { HoodScore } from "@/lib/scan/types";
import { cn } from "@/lib/utils";

const GRADE_STYLE: Record<HoodScore["grade"], string> = {
  A: "text-success border-success/30 bg-success/10",
  B: "text-moss-soft border-moss/30 bg-moss/10",
  C: "text-warning border-warning/30 bg-warning/10",
  D: "text-warning border-warning/30 bg-warning/10",
  F: "text-danger border-danger/30 bg-danger/10",
};

const SIGNAL_DOT: Record<"good" | "warn" | "bad", string> = {
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-danger",
};

export function ScoreCard({ score }: { score: HoodScore }) {
  return (
    <GlassPanel className="p-5">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div
          className={cn(
            "flex h-24 w-24 shrink-0 flex-col items-center justify-center rounded-lg border",
            GRADE_STYLE[score.grade],
          )}
        >
          <div className="text-3xl font-bold leading-none">{score.grade}</div>
          <div className="mt-1 text-xs opacity-80">{score.score}/100</div>
        </div>
        <div className="min-w-0">
          <div className="text-lg font-semibold text-ink">{score.category}</div>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">{score.reason}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {score.signals.map((signal, i) => (
          <div key={i} className="flex items-start gap-2 rounded-lg bg-white/[0.03] px-3 py-2">
            <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", SIGNAL_DOT[signal.kind])} />
            <div className="min-w-0">
              <div className="text-xs text-ink-muted">{signal.label}</div>
              {signal.detail && <div className="text-[11px] text-ink-faint">{signal.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}
