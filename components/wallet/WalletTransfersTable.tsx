import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { GlassPanel } from "@/components/ui/GlassPanel";
import type { WalletTransferRow } from "@/lib/scan/wallet-types";
import { shortNumber } from "@/lib/scan/adapter";
import { formatAge } from "@/lib/scan/format";
import { formatCompactNumber, shortAddress, cn } from "@/lib/utils";

const MAX_ROWS = 200;

export function WalletTransfersTable({
  transfers,
  // See OpenPositionsTable / TransfersList's matching prop.
  expanded = false,
}: {
  transfers: WalletTransferRow[];
  expanded?: boolean;
}) {
  const rows = transfers.slice(0, MAX_ROWS);
  const nowSec = Math.floor(Date.now() / 1000);

  const content = (
    <>
      {!expanded && transfers.length > MAX_ROWS && (
        <p className="mb-3 text-[11px] text-ink-faint">
          Showing the most recent {MAX_ROWS} of {formatCompactNumber(transfers.length)}.
        </p>
      )}
      {transfers.length === 0 ? (
        <p className="text-xs text-ink-faint">No transfers found in this scan window.</p>
      ) : (
        <div
          className={cn("overflow-x-auto", !expanded && "max-h-[650px] overflow-y-auto")}
        >
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="sticky top-0 border-b border-line-strong bg-canvas/90 text-left text-[11px] uppercase tracking-wide text-ink-faint backdrop-blur">
                <th className="px-2 py-2 font-medium">Time</th>
                <th className="px-2 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  Direction
                </th>
                <th className="px-2 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  Token
                </th>
                <th className="px-2 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  Amount
                </th>
                <th className="px-2 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  From
                </th>
                <th className="px-4 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  To
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => (
                <tr
                  key={`${t.hash}-${i}`}
                  className="divide-x divide-line-strong border-b border-line-strong transition last:border-b-0 hover:bg-white/[0.02]"
                >
                  <td className="px-2 py-2.5 whitespace-nowrap text-ink-faint">
                    {t.timestamp > 0 ? formatAge(Math.max(0, nowSec - t.timestamp)) : "—"}
                  </td>
                  <td className="px-2 py-2.5 text-right">
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
                  <td className="px-2 py-2.5 text-right font-medium text-ink">{t.token.symbol}</td>
                  <td className="px-2 py-2.5 text-right text-ink-muted">{shortNumber(t.amount)}</td>
                  <td className="px-2 py-2.5 text-right font-mono text-xs text-ink-faint">
                    {shortAddress(t.from)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs text-ink-faint">
                    {shortAddress(t.to)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  if (expanded) return content;

  return (
    <GlassPanel className="overflow-hidden p-4">
      <div className="mb-3 text-sm font-medium text-ink">
        Transfers <span className="text-ink-faint">({formatCompactNumber(transfers.length)})</span>
      </div>
      {content}
    </GlassPanel>
  );
}
