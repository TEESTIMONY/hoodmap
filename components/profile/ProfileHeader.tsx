import { Award } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { TierChip } from "@/components/ui/Chip";
import { StatCard } from "@/components/ui/GlassPanel";
import { CopyAddress } from "@/components/profile/CopyAddress";
import type { Person } from "@/lib/mock-data";
import { formatCompactNumber } from "@/lib/utils";

export function ProfileHeader({ person }: { person: Person }) {
  return (
    <div className="animate-fade-up">
      <div className="relative h-36 overflow-hidden rounded-t-lg md:h-44">
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 20% 20%, rgba(214, 250, 77,0.55), transparent 55%), radial-gradient(circle at 80% 60%, rgba(23, 176, 74,0.5), transparent 55%), #0d0f14",
          }}
        />
      </div>

      <div className="px-4 md:px-2">
        <div className="-mt-12 flex items-end justify-between">
          <Avatar
            seed={person.colorSeed}
            name={person.name}
            tier={person.tier}
            size="xl"
            className="ring-4 ring-canvas rounded-full"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-ink">{person.name}</h1>
          <TierChip tier={person.tier} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-ink-faint">@{person.handle}</span>
          <CopyAddress address={person.address} />
        </div>

        <p className="mt-3 max-w-lg text-sm leading-relaxed text-ink-muted">{person.bio}</p>

        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatCard label="Followers" value={formatCompactNumber(person.followers)} />
          <StatCard label="Following" value={formatCompactNumber(person.following)} />
          <StatCard label="Reputation" value={formatCompactNumber(person.reputation)} />
          <StatCard label="Signals" value={formatCompactNumber(person.signalsReceived)} />
        </div>

        {person.badges.length > 0 && (
          <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
            {person.badges.map((badge) => (
              <div
                key={badge}
                className="glass-panel flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-ink-muted"
              >
                <Award className="h-3.5 w-3.5 text-moss-soft" />
                {badge}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
