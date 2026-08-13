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

// Lives in a narrow, always-vertical sidebar column now (paired beside the
// chart) rather than a full-width slot — so this deliberately doesn't use
// sm: breakpoints to go horizontal/two-column the way it used to. A 640px
// viewport breakpoint has no idea the column itself is ~280px wide; letting
// it "widen up" here just cramped the grade box against the text and wrapped
// signal tiles into a 2-column grid with no room, in a column this narrow.
export function ScoreCard({ score }: { score: HoodScore }) {
  return (
    <GlassPanel className="h-full p-4">
      <div className="flex flex-col items-center gap-3 text-center">
        <div
          className={cn(
            "flex h-20 w-20 shrink-0 flex-col items-center justify-center rounded-[8px] border",
            GRADE_STYLE[score.grade],
          )}
        >
          <div className="text-2xl font-bold leading-none">{score.grade}</div>
          <div className="mt-1 text-xs opacity-80">{score.score}/100</div>
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink">{score.category}</div>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">{score.reason}</p>
        </div>
      </div>

      {/* Two per line instead of one — the same signals stacked one-per-row
          ran the card on for six full rows of mostly-empty width. Grid
          (not sm:grid-cols-2) because this column's own width, not the
          viewport, is what decides whether two fit — and at ~280px it
          reliably does. */}
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {score.signals.map((signal, i) => (
          <div key={i} className="flex items-start gap-1.5 rounded-[8px] bg-white/[0.03] px-2 py-1.5">
            <span className={cn("mt-1 h-1.5 w-1.5 shrink-0 rounded-full", SIGNAL_DOT[signal.kind])} />
            <div className="min-w-0">
              <div className="text-[11px] leading-snug text-ink-muted">{signal.label}</div>
              {signal.detail && <div className="text-[10px] leading-snug text-ink-faint">{signal.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
}
