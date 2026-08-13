import { CopyAddress } from "@/components/profile/CopyAddress";
import { Avatar } from "@/components/ui/Avatar";
import { GlassPanel } from "@/components/ui/GlassPanel";
import type { TokenMeta } from "@/lib/scan/types";

function formatAgo(seconds?: number): string {
  if (seconds == null) return "Unknown age";
  const days = Math.floor(seconds / 86400);
  if (days > 0) return `${days}d old`;
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return `${hours}h old`;
  return `${Math.floor(seconds / 60)}m old`;
}

// Lives only in the sidebar now — the page-level copy above the chart was
// dropped as a duplicate of this. Sized up (lg avatar, larger name text)
// since it's the one and only place this identity shows now, rather than
// staying at the small "just a label above the stats" size it had when it
// was a second, secondary copy next to the full-width original.
export function TokenHeader({ token }: { token: TokenMeta }) {
  return (
    <GlassPanel className="p-5 animate-fade-up">
      <div className="flex items-start gap-3">
        <Avatar seed={token.address} name={token.symbol || token.name} size="lg" ring={false} imageUrl={token.imageUrl} />
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold leading-snug text-ink">
            {token.name} <span className="text-ink-faint">({token.symbol})</span>
          </div>
          <div className="mt-1 text-xs text-ink-faint">{formatAgo(token.createdAgoSeconds)}</div>
          <div className="mt-2 flex items-center gap-2">
            <CopyAddress address={token.address} />
            {token.dexUrl && (
              <a
                href={token.dexUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-moss-soft hover:underline"
              >
                View chart
              </a>
            )}
          </div>
        </div>
      </div>
    </GlassPanel>
  );
}
