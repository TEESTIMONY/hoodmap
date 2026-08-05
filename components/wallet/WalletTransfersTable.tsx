import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { GlassPanel } from "@/components/ui/GlassPanel";
import type { WalletTransferRow } from "@/lib/scan/wallet-types";
import { shortNumber } from "@/lib/scan/adapter";
import { formatAge } from "@/lib/scan/format";
import { formatCompactNumber, shortAddress, cn } from "@/lib/utils";

const MAX_ROWS = 200;

export function WalletTransfersTable({ transfers }: { transfers: WalletTransferRow[] }) {
  const rows = transfers.slice(0, MAX_ROWS);
  const nowSec = Math.floor(Date.now() / 1000);

  return (
    <GlassPanel className="overflow-hidden p-4">
      <div className="mb-1 text-sm font-medium text-ink">
        All transfers <span className="text-ink-faint">({formatCompactNumber(transfers.length)})</span>
      </div>
      <p className="mb-3 text-[11px] text-ink-faint">
        Every transfer found in the scan window, including ones that couldn't be priced as a trade.
        {transfers.length > MAX_ROWS && ` Showing the most recent ${MAX_ROWS}.`}
      </p>
      {transfers.length === 0 ? (
        <p className="text-xs text-ink-faint">No transfers found in this scan window.</p>
      ) : (
        <div className="max-h-[480px] overflow-y-auto overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="sticky top-0 border-b border-line bg-canvas/90 text-left text-[11px] uppercase tracking-wide text-ink-faint backdrop-blur">
                <th className="px-2 py-2 font-medium">Time</th>
                <th className="px-2 py-2 font-medium">Direction</th>
                <th className="px-2 py-2 font-medium">Token</th>
                <th className="px-2 py-2 text-right font-medium">Amount</th>
                <th className="px-2 py-2 font-medium">From</th>
                <th className="px-4 py-2 font-medium">To</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => (
                <tr key={`${t.hash}-${i}`} className="border-b border-line/60 last:border-0">
                  <td className="px-2 py-2.5 text-ink-faint">
                    {t.timestamp > 0 ? formatAge(Math.max(0, nowSec - t.timestamp)) : "—"}
                  </td>
                  <td className="px-2 py-2.5">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        t.direction === "in" ? "text-success bg-success/10" : "text-danger bg-danger/10",
                      )}
                    >
                      {t.direction === "in" ? (
                        <ArrowDownLeft className="h-3 w-3" />
                      ) : (
                        <ArrowUpRight className="h-3 w-3" />
                      )}
                      {t.direction === "in" ? "In" : "Out"}
                    </span>
                  </td>
                  <td className="px-2 py-2.5 font-medium text-ink">{t.token.symbol}</td>
                  <td className="px-2 py-2.5 text-right text-ink-muted">{shortNumber(t.amount)}</td>
                  <td className="px-2 py-2.5 font-mono text-ink-faint">{shortAddress(t.from)}</td>
                  <td className="px-4 py-2.5 font-mono text-ink-faint">{shortAddress(t.to)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GlassPanel>
  );
}
