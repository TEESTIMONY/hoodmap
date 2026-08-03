"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Activity } from "lucide-react";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { channels, people } from "@/lib/mock-data";
import { formatCompactNumber } from "@/lib/utils";

const BAR_COUNT = 24;

function randomBars(): number[] {
  return Array.from({ length: BAR_COUNT }, () => 0.25 + Math.random() * 0.75);
}

export function PulseWidget() {
  const [bars, setBars] = useState<number[]>(() => randomBars());
  const [signalsThisHour, setSignalsThisHour] = useState(4820);

  useEffect(() => {
    const id = setInterval(() => {
      setBars(randomBars());
      setSignalsThisHour((n) => n + Math.floor(Math.random() * 12));
    }, 2200);
    return () => clearInterval(id);
  }, []);

  const trending = [...channels].sort((a, b) => b.members - a.members).slice(0, 4);
  const suggestions = people.filter((p) => p.id !== "me").slice(0, 3);

  return (
    <div className="flex flex-col gap-5">
      <GlassPanel className="p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
          <Activity className="h-4 w-4 text-moss-soft" />
          Network pulse
        </div>
        <div className="flex h-16 items-end gap-[3px]">
          {bars.map((h, i) => (
            <motion.div
              key={i}
              animate={{ height: `${h * 100}%` }}
              transition={{ duration: 1.4, ease: "easeInOut" }}
              className="flex-1 rounded-full bg-gradient-to-t from-lime/70 to-moss/70"
              style={{ minHeight: 4 }}
            />
          ))}
        </div>
        <div className="mt-3 text-xs text-ink-faint">
          <span className="font-medium text-ink">{formatCompactNumber(signalsThisHour)}</span> signals
          sent in the last hour
        </div>
      </GlassPanel>

      <GlassPanel className="p-4">
        <div className="mb-3 text-sm font-medium text-ink">Trending channels</div>
        <div className="flex flex-col gap-3">
          {trending.map((c) => (
            <div key={c.id} className="flex items-center justify-between text-sm">
              <span className="text-ink-muted">#{c.name}</span>
              <span className="text-xs text-ink-faint">{formatCompactNumber(c.members)}</span>
            </div>
          ))}
        </div>
      </GlassPanel>

      <GlassPanel className="p-4">
        <div className="mb-3 text-sm font-medium text-ink">Who to follow</div>
        <div className="flex flex-col gap-3">
          {suggestions.map((p) => (
            <div key={p.id} className="flex items-center gap-2.5">
              <Avatar seed={p.colorSeed} name={p.name} tier={p.tier} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-ink">{p.name}</div>
                <div className="truncate font-mono text-xs text-ink-faint">@{p.handle}</div>
              </div>
              <Button variant="glass" size="sm" className="shrink-0">
                Follow
              </Button>
            </div>
          ))}
        </div>
      </GlassPanel>
    </div>
  );
}
