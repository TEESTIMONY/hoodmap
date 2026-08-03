import type { WalletRole } from "@/lib/scan/types";

export const ROLE_LABEL: Record<WalletRole, string> = {
  developer: "Deployer",
  liquidity: "Liquidity",
  exchange: "Exchange",
  whale: "Whale",
  holder: "Holder",
  sniper: "Sniper",
  insider: "Insider",
  burn: "Burn",
  contract: "Contract",
};

export const ROLE_DOT_CLASS: Record<WalletRole, string> = {
  developer: "bg-warning",
  liquidity: "bg-moss-soft",
  exchange: "bg-moss-soft",
  whale: "bg-lime-soft",
  holder: "bg-ink-faint",
  sniper: "bg-danger",
  insider: "bg-danger",
  burn: "bg-ink-faint",
  contract: "bg-ink-muted",
};

export const ROLE_TEXT_CLASS: Record<WalletRole, string> = {
  developer: "text-warning",
  liquidity: "text-moss-soft",
  exchange: "text-moss-soft",
  whale: "text-lime-soft",
  holder: "text-ink-muted",
  sniper: "text-danger",
  insider: "text-danger",
  burn: "text-ink-faint",
  contract: "text-ink-muted",
};

export function formatAge(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Compact age without a suffix — "10d", "3h", "22m" — for dense table cells. */
export function formatCompactAge(seconds: number): string {
  if (seconds < 60) return `${Math.max(0, Math.round(seconds))}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}
