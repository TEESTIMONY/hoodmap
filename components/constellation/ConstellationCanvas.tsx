"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Trophy, X, Zap } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { TierChip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/Button";
import { computeConstellationLayout, type NodePosition } from "@/lib/constellation";
import { edges as allEdges, peopleById, people, type Person } from "@/lib/mock-data";
import { formatCompactNumber } from "@/lib/utils";

const CENTER_ID = "me";
const TIER_SIZE: Record<Person["tier"], "sm" | "md" | "lg" | "xl"> = {
  new: "sm",
  member: "md",
  core: "md",
  legendary: "lg",
};

interface Pulse {
  id: string;
  from: NodePosition;
  to: NodePosition;
  toId: string;
  ambient: boolean;
}

interface TickerEntry {
  id: string;
  text: string;
  mine: boolean;
}

export function ConstellationCanvas() {
  const positions = computeConstellationLayout(CENTER_ID, people, allEdges);
  const [selected, setSelected] = useState<string | null>(null);
  const [pulses, setPulses] = useState<Pulse[]>([]);
  const [ticker, setTicker] = useState<TickerEntry[]>([]);
  const [liveSignals, setLiveSignals] = useState<Record<string, number>>({});
  const [flash, setFlash] = useState<string | null>(null);
  const [hintDismissed, setHintDismissed] = useState(false);
  const flashTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ambient network activity — makes the graph feel alive even before you
  // send your own signal.
  useEffect(() => {
    const id = setInterval(() => {
      const candidates = allEdges.filter((e) => e.from !== CENTER_ID && e.to !== CENTER_ID);
      const edge = candidates[Math.floor(Math.random() * candidates.length)];
      if (!edge) return;
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) return;
      firePulse(edge.from, edge.to, from, to, true);
    }, 2800);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function firePulse(fromId: string, toId: string, from: NodePosition, to: NodePosition, ambient: boolean) {
    const pulseId = `${Date.now()}-${Math.random()}`;
    setPulses((p) => [...p, { id: pulseId, from, to, toId, ambient }]);

    const fromPerson = peopleById.get(fromId);
    const toPerson = peopleById.get(toId);
    if (fromPerson && toPerson) {
      const text = ambient
        ? `${fromPerson.name} signaled @${toPerson.handle}`
        : `You signaled @${toPerson.handle}`;
      setTicker((t) => [{ id: pulseId, text, mine: !ambient }, ...t].slice(0, 14));
    }
  }

  function handleArrive(pulse: Pulse) {
    setPulses((p) => p.filter((x) => x.id !== pulse.id));
    setLiveSignals((counts) => ({ ...counts, [pulse.toId]: (counts[pulse.toId] ?? 0) + 1 }));
    if (!pulse.ambient) {
      setFlash(pulse.toId);
      if (flashTimeout.current) clearTimeout(flashTimeout.current);
      flashTimeout.current = setTimeout(() => setFlash(null), 900);
    }
  }

  function sendSignal(toId: string) {
    if (toId === CENTER_ID) return;
    const from = positions.get(CENTER_ID);
    const to = positions.get(toId);
    if (!from || !to) return;
    firePulse(CENTER_ID, toId, from, to, false);
    setHintDismissed(true);
  }

  const selectedPerson = selected ? peopleById.get(selected) : undefined;
  const selectedPos = selected ? positions.get(selected) : undefined;

  const leaderboard = [...people]
    .map((p) => ({ person: p, total: p.signalsReceived + (liveSignals[p.id] ?? 0) }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return (
    <div className="flex h-[calc(100vh-57px)] flex-col lg:flex-row">
      {/* Canvas */}
      <div className="relative flex-1 overflow-hidden border-b border-line lg:border-b-0 lg:border-r">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 30% 20%, rgba(214, 250, 77,0.16), transparent 45%), radial-gradient(circle at 75% 70%, rgba(23, 176, 74,0.14), transparent 45%), #06070a",
          }}
        />

        {!hintDismissed && (
          <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 animate-fade-up rounded-full border border-line bg-canvas/80 px-4 py-2 text-xs text-ink-muted backdrop-blur">
            Click a node, then send a signal.
          </div>
        )}

        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <defs>
            <linearGradient id="edge-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#D6FA4D" />
              <stop offset="100%" stopColor="#17B04A" />
            </linearGradient>
          </defs>
          {allEdges.map((edge, i) => {
            const a = positions.get(edge.from);
            const b = positions.get(edge.to);
            if (!a || !b) return null;
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="url(#edge-grad)"
                strokeWidth={0.15 + edge.strength * 0.35}
                strokeOpacity={edge.from === CENTER_ID || edge.to === CENTER_ID ? 0.45 : 0.2}
              />
            );
          })}
        </svg>

        <AnimatePresence>
          {pulses.map((pulse) => (
            <motion.div
              key={pulse.id}
              className="absolute z-10 rounded-full"
              style={{
                width: pulse.ambient ? 5 : 8,
                height: pulse.ambient ? 5 : 8,
                marginLeft: pulse.ambient ? -2.5 : -4,
                marginTop: pulse.ambient ? -2.5 : -4,
                background: pulse.ambient ? "#7CE38A" : "#EAFFAE",
                boxShadow: pulse.ambient
                  ? "0 0 8px 2px rgba(23, 176, 74,0.5)"
                  : "0 0 16px 5px rgba(214, 250, 77,0.7)",
              }}
              initial={{ left: `${pulse.from.x}%`, top: `${pulse.from.y}%`, opacity: 1 }}
              animate={{ left: `${pulse.to.x}%`, top: `${pulse.to.y}%`, opacity: [1, 1, 0.2] }}
              exit={{ opacity: 0 }}
              transition={{ duration: pulse.ambient ? 1.5 : 0.8, ease: "easeInOut" }}
              onAnimationComplete={() => handleArrive(pulse)}
            />
          ))}
        </AnimatePresence>

        {people.map((p) => {
          const pos = positions.get(p.id);
          if (!pos) return null;
          const isFlashing = flash === p.id;
          const isSelected = selected === p.id;
          return (
            <motion.button
              key={p.id}
              onClick={() => setSelected(p.id === selected ? null : p.id)}
              className="absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full focus-visible:outline-none"
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              animate={{
                y: [0, -5, 0],
                scale: isFlashing ? [1, 1.35, 1] : 1,
              }}
              transition={{
                y: { duration: 5 + (pos.x % 3), repeat: Infinity, ease: "easeInOut", delay: (pos.y % 5) * 0.2 },
                scale: { duration: 0.7, ease: "easeOut" },
              }}
            >
              <div
                className="rounded-full transition"
                style={{
                  boxShadow: isSelected
                    ? "0 0 0 3px rgba(214, 250, 77,0.5)"
                    : isFlashing
                      ? "0 0 24px 8px rgba(214, 250, 77,0.55)"
                      : "none",
                }}
              >
                <Avatar
                  seed={p.colorSeed}
                  name={p.name}
                  tier={p.tier}
                  size={p.id === CENTER_ID ? "lg" : TIER_SIZE[p.tier]}
                />
              </div>
              <div className="mt-1 truncate text-center text-[10px] text-ink-faint">
                {p.id === CENTER_ID ? "You" : p.name.split(" ")[0]}
              </div>
            </motion.button>
          );
        })}

        <AnimatePresence>
          {selectedPerson && selectedPos && (
            <motion.div
              initial={{ opacity: 0, scale: 0.94, y: 6 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.18 }}
              className="glass-panel absolute z-20 w-64 rounded-[10px] p-4 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.6)]"
              style={{
                left: `${Math.min(78, Math.max(10, selectedPos.x))}%`,
                top: `${Math.min(78, Math.max(6, selectedPos.y))}%`,
              }}
            >
              <button
                onClick={() => setSelected(null)}
                className="absolute right-3 top-3 text-ink-faint hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="flex items-center gap-2.5">
                <Avatar seed={selectedPerson.colorSeed} name={selectedPerson.name} tier={selectedPerson.tier} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{selectedPerson.name}</div>
                  <div className="truncate font-mono text-xs text-ink-faint">@{selectedPerson.handle}</div>
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <TierChip tier={selectedPerson.tier} />
                <span className="text-xs text-ink-faint">
                  {formatCompactNumber(selectedPerson.reputation)} rep
                </span>
              </div>
              {selectedPerson.id === CENTER_ID ? (
                <p className="mt-3 text-xs text-ink-faint">This is you.</p>
              ) : (
                <Button
                  size="sm"
                  className="mt-3 w-full"
                  onClick={() => sendSignal(selectedPerson.id)}
                >
                  <Zap className="h-3.5 w-3.5" />
                  Send signal
                </Button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="glass-panel absolute bottom-4 left-4 z-10 flex items-center gap-3 rounded-full px-3 py-1.5 text-[11px] text-ink-faint">
          <LegendDot className="bg-ink-faint" label="New" />
          <LegendDot className="bg-lime-soft" label="Member" />
          <LegendDot className="bg-moss-soft" label="Core" />
          <LegendDot className="bg-gradient-to-r from-lime to-moss" label="Legendary" />
        </div>
      </div>

      {/* Side panel */}
      <div className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto p-4 lg:w-80">
        <div className="glass-panel rounded-[10px] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-moss opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-moss" />
            </span>
            Live signals
          </div>
          <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
            <AnimatePresence initial={false}>
              {ticker.map((entry) => (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={`rounded-lg px-2.5 py-1.5 text-xs ${
                    entry.mine ? "bg-lime/10 text-lime-soft" : "text-ink-faint"
                  }`}
                >
                  {entry.text}
                </motion.div>
              ))}
            </AnimatePresence>
            {ticker.length === 0 && (
              <div className="px-2.5 py-1.5 text-xs text-ink-faint">Waiting for the first signal…</div>
            )}
          </div>
        </div>

        <div className="glass-panel rounded-[10px] p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-ink">
            <Trophy className="h-4 w-4 text-warning" />
            Most signaled today
          </div>
          <div className="flex flex-col gap-3">
            {leaderboard.map((row, i) => (
              <div key={row.person.id} className="flex items-center gap-2.5">
                <span
                  className={`w-4 text-xs font-semibold ${
                    i === 0
                      ? "text-warning"
                      : i === 1
                        ? "text-ink-muted"
                        : i === 2
                          ? "text-[#c98a4b]"
                          : "text-ink-faint"
                  }`}
                >
                  {i + 1}
                </span>
                <Avatar seed={row.person.colorSeed} name={row.person.name} tier={row.person.tier} size="sm" />
                <div className="min-w-0 flex-1 truncate text-sm text-ink-muted">{row.person.name}</div>
                <div className="text-xs text-ink-faint">{formatCompactNumber(row.total)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`h-2 w-2 rounded-full ${className}`} />
      {label}
    </span>
  );
}
