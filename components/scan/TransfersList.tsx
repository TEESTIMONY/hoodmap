import { GlassPanel } from "@/components/ui/GlassPanel";
import type { Transfer } from "@/lib/scan/types";
import { shortAddress } from "@/lib/utils";
import { shortNumber } from "@/lib/scan/adapter";
import { formatAge } from "@/lib/scan/format";
import { cn } from "@/lib/utils";

const KIND_STYLE: Record<Transfer["kind"], string> = {
  buy: "text-success bg-success/10",
  sell: "text-danger bg-danger/10",
  mint: "text-moss-soft bg-moss/10",
  burn: "text-ink-faint bg-white/[0.05]",
  transfer: "text-ink-muted bg-white/[0.05]",
};

export function TransfersList({ transfers }: { transfers: Transfer[] }) {
  return (
    <GlassPanel className="p-4">
      <div className="mb-3 text-sm font-medium text-ink">Recent transfers</div>
      {transfers.length === 0 ? (
        <p className="text-xs text-ink-faint">No transfers observed in this scan window.</p>
      ) : (
        <div className="flex max-h-[420px] flex-col divide-y divide-line overflow-y-auto pr-1">
          {transfers.map((t) => (
            <div key={`${t.hash}-${t.logIndex}`} className="flex flex-wrap items-center gap-2 py-2 text-xs first:pt-0 last:pb-0">
              <span className={cn("rounded-full px-2 py-0.5 font-medium uppercase tracking-wide", KIND_STYLE[t.kind])}>
                {t.kind}
              </span>
              <span className="font-mono text-ink-muted">{shortAddress(t.from)}</span>
              <span className="text-ink-faint">→</span>
              <span className="font-mono text-ink-muted">{shortAddress(t.to)}</span>
              <span className="ml-auto text-ink">{shortNumber(t.amount)}</span>
              <span className="w-16 text-right text-ink-faint">{formatAge(t.ageSeconds)}</span>
            </div>
          ))}
        </div>
      )}
    </GlassPanel>
  );
}
