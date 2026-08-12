import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function GlassPanel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("glass-panel rounded-[10px]", className)}
      {...props}
    />
  );
}

export function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="glass-panel rounded-[8px] px-4 py-3">
      <div className="text-lg font-semibold text-ink">{value}</div>
      <div className="text-xs text-ink-faint">{label}</div>
    </div>
  );
}
