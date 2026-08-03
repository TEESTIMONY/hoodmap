import { hashString } from "@/lib/utils";
import type { Tier } from "@/lib/mock-data";

// Deliberately mostly lime/moss-free: those two hues are the brand accent
// used throughout the chrome (buttons, active nav, tier rings), so avatars
// lean on other hues to stay visually distinct from UI elements — only one
// pair below touches the secondary brand color (moss) as a subtle nod.
const GRADIENTS: [string, string][] = [
  ["#FF6CAB", "#7C5CFF"],
  ["#3B82F6", "#7C5CFF"],
  ["#FBBF24", "#FB7185"],
  ["#34D399", "#3B82F6"],
  ["#FB7185", "#FBBF24"],
  ["#7C5CFF", "#FF6CAB"],
  ["#17B04A", "#3B82F6"],
  ["#FBBF24", "#34D399"],
];

const SIZE_PX: Record<"xs" | "sm" | "md" | "lg" | "xl", number> = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 56,
  xl: 88,
};

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function gradientFor(seed: string): [string, string] {
  return GRADIENTS[hashString(seed) % GRADIENTS.length];
}

interface AvatarProps {
  seed: string;
  name: string;
  size?: keyof typeof SIZE_PX;
  tier?: Tier;
  ring?: boolean;
  className?: string;
}

export function Avatar({ seed, name, size = "md", tier, ring = true, className = "" }: AvatarProps) {
  const px = SIZE_PX[size];
  const [from, to] = gradientFor(seed);
  const fontSize = Math.max(10, Math.round(px * 0.36));

  const core = (
    <div
      className="flex items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: px,
        height: px,
        fontSize,
        background: `linear-gradient(135deg, ${from}, ${to})`,
      }}
    >
      {initials(name)}
    </div>
  );

  if (!ring || !tier) {
    return <div className={className}>{core}</div>;
  }

  const wrapperStyle = { width: px + 6, height: px + 6, padding: 3 };

  if (tier === "legendary") {
    return (
      <div
        className={`aura-ring flex items-center justify-center rounded-full shadow-[var(--shadow-glow-lime)] ${className}`}
        style={wrapperStyle}
      >
        <div className="rounded-full bg-canvas p-[2px]">{core}</div>
      </div>
    );
  }

  const ringColor =
    tier === "core"
      ? "linear-gradient(135deg, var(--color-lime), var(--color-moss))"
      : tier === "member"
        ? "var(--color-lime-soft)"
        : "var(--color-line-strong)";

  return (
    <div
      className={`flex items-center justify-center rounded-full ${className}`}
      style={{ ...wrapperStyle, background: ringColor }}
    >
      <div className="rounded-full bg-canvas p-[2px]">{core}</div>
    </div>
  );
}
