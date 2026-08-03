"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { Avatar } from "@/components/ui/Avatar";
import { computeConstellationLayout } from "@/lib/constellation";
import { edges as allEdges, peopleById, people } from "@/lib/mock-data";

/** Small, mostly-static preview of a person's slice of the Constellation graph. */
export function MiniConstellation({ centerId }: { centerId: string }) {
  const relevantEdges = allEdges.filter((e) => e.from === centerId || e.to === centerId);
  const neighborIds = relevantEdges.map((e) => (e.from === centerId ? e.to : e.from));
  const nodeIds = [centerId, ...neighborIds];
  const nodePeople = people.filter((p) => nodeIds.includes(p.id));

  const positions = computeConstellationLayout(centerId, nodePeople, relevantEdges);

  return (
    <div className="glass-panel relative h-72 overflow-hidden rounded-2xl">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {relevantEdges.map((edge, i) => {
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
              stroke="url(#mini-edge)"
              strokeWidth={0.3 + edge.strength * 0.4}
              strokeOpacity={0.5}
            />
          );
        })}
        <defs>
          <linearGradient id="mini-edge" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#D6FA4D" />
            <stop offset="100%" stopColor="#17B04A" />
          </linearGradient>
        </defs>
      </svg>

      {nodePeople.map((p) => {
        const pos = positions.get(p.id);
        if (!pos) return null;
        return (
          <motion.div
            key={p.id}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            animate={{ y: [0, -4, 0] }}
            transition={{
              duration: 5 + (pos.x % 3),
              repeat: Infinity,
              ease: "easeInOut",
              delay: (pos.y % 5) * 0.2,
            }}
          >
            <Link href={`/profile/${p.handle}`} title={p.name}>
              <Avatar seed={p.colorSeed} name={p.name} tier={p.tier} size={p.id === centerId ? "lg" : "sm"} />
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
}

export function centerLabelFor(id: string) {
  return peopleById.get(id)?.name ?? id;
}
