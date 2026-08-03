import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Tier } from "@/lib/mock-data";
import { TIER_LABEL } from "@/lib/mock-data";

export function Chip({
  children,
  className,
  icon,
}: {
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-line bg-white/[0.04] px-2.5 py-1 text-xs text-ink-muted",
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

const TIER_STYLES: Record<Tier, string> = {
  new: "border-line text-ink-faint bg-white/[0.03]",
  member: "border-lime/30 text-lime-soft bg-lime/10",
  core: "border-moss/30 text-moss-soft bg-moss/10",
  legendary:
    "border-transparent text-canvas bg-gradient-to-r from-lime to-moss shadow-[var(--shadow-glow-lime)]",
};

export function TierChip({ tier, className }: { tier: Tier; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium tracking-wide",
        TIER_STYLES[tier],
        className,
      )}
    >
      {TIER_LABEL[tier]}
    </span>
  );
}
