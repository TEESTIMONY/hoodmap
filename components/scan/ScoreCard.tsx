import { GlassPanel } from "@/components/ui/GlassPanel";
import type { HoodScore } from "@/lib/scan/types";
import { cn } from "@/lib/utils";

const GRADE_STYLE: Record<HoodScore["grade"], string> = {
  A: "text-success",
  B: "text-moss-soft",
  C: "text-warning",
  D: "text-warning",
  F: "text-danger",
};

// The ring gauge below is drawn with a conic-gradient, which needs an
// actual CSS color to sweep through — a Tailwind class like GRADE_STYLE's
// can't be used inline for that, so this is the same four colors resolved
// to their CSS custom properties instead.
const GRADE_RING_COLOR: Record<HoodScore["grade"], string> = {
  A: "var(--color-success)",
  B: "var(--color-moss)",
  C: "var(--color-warning)",
  D: "var(--color-warning)",
  F: "var(--color-danger)",
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
    <GlassPanel className="p-4">
      <div className="flex flex-col items-center gap-3 text-center">
        {/* A ring gauge reads at a glance as "how full is this score" —
            the flat bordered square it replaced showed the same two
            numbers but with no visual sense of 100/100 vs. 40/100 short of
            actually reading the text. The ring's sweep is the score itself
            (conic-gradient from 0deg), so the fill directly represents the
            fraction; the inner circle just masks the middle back down to a
            ring, colored to match the surrounding GlassPanel exactly so it
            doesn't read as a separate layered box. */}
        <div
          className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full"
          style={{
            background: `conic-gradient(${GRADE_RING_COLOR[score.grade]} ${score.score * 3.6}deg, var(--color-line-strong) 0deg)`,
          }}
        >
          <div className="flex h-[78px] w-[78px] flex-col items-center justify-center rounded-full bg-[var(--color-surface)]">
            <div className={cn("text-2xl font-bold leading-none", GRADE_STYLE[score.grade])}>{score.grade}</div>
            <div className="mt-1 text-xs text-ink-muted">{score.score}/100</div>
          </div>
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
