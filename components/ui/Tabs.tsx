"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  id: string;
  label: string;
  count?: number;
  icon?: ReactNode;
  // Per-tab escape hatch for a button that shouldn't always show — e.g.
  // the scan page's mobile-only "Chart" tab (className: "lg:hidden").
  buttonClassName?: string;
}

// Shared tab-bar visual language (underline gradient bar) — matches
// components/profile/ProfileTabs.tsx, generalized so any section of the
// app can use the same look without duplicating it.
export function Tabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        // self-start + w-fit: this bar sits in a flex-col parent, which
        // stretches children to full width by default — without
        // overriding that, the border-b below trails off into a long
        // stretch of empty space past the last tab. Sizing to content
        // (capped at max-w-full so overflow-x-auto still kicks in if the
        // tabs themselves overflow a narrow viewport) makes the
        // underline hug the actual tab labels instead.
        "inline-flex w-fit max-w-full shrink-0 self-start gap-1 overflow-x-auto border-b border-line",
        className,
      )}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          aria-current={active === tab.id ? "true" : undefined}
          className={cn(
            "relative flex shrink-0 items-center gap-1.5 whitespace-nowrap px-4 py-3 text-sm transition",
            active === tab.id ? "text-ink" : "text-ink-faint hover:text-ink-muted",
            tab.buttonClassName,
          )}
        >
          {tab.icon}
          {tab.label}
          {tab.count != null && (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] leading-none",
                active === tab.id ? "bg-white/[0.08] text-ink-muted" : "bg-white/[0.04] text-ink-faint",
              )}
            >
              {tab.count}
            </span>
          )}
          {active === tab.id && (
            <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-gradient-to-r from-lime to-moss" />
          )}
        </button>
      ))}
    </div>
  );
}
