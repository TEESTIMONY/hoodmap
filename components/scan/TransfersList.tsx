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
    <GlassPanel className="overflow-hidden p-4">
      <div className="mb-3 text-sm font-medium text-ink">Recent transfers</div>
      {transfers.length === 0 ? (
        <p className="text-xs text-ink-faint">No transfers observed in this scan window.</p>
      ) : (
        <div className="max-h-[420px] overflow-y-auto overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="sticky top-0 border-b border-line bg-canvas/90 text-left text-[11px] uppercase tracking-wide text-ink-faint backdrop-blur">
                <th className="px-2 py-2 font-medium">Kind</th>
                <th className="px-2 py-2 font-medium">From</th>
                <th className="px-2 py-2 font-medium">To</th>
                <th className="px-2 py-2 text-right font-medium">Amount</th>
                <th className="px-4 py-2 text-right font-medium">Age</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => (
                <tr
                  key={`${t.hash}-${t.logIndex}`}
                  className="border-b border-line/60 transition last:border-0 hover:bg-white/[0.02]"
                >
                  <td className="px-2 py-2.5">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                        KIND_STYLE[t.kind],
                      )}
                    >
                      {t.kind}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 font-mono text-xs text-ink-muted">{shortAddress(t.from)}</td>
                  <td className="px-2 py-2.5 font-mono text-xs text-ink-muted">{shortAddress(t.to)}</td>
                  <td className="px-2 py-2.5 text-right text-ink">{shortNumber(t.amount)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-faint">{formatAge(t.ageSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GlassPanel>
  );
}
