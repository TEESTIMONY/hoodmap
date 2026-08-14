import { GlassPanel } from "@/components/ui/GlassPanel";
import type { OpenPosition } from "@/lib/scan/wallet-types";
import { shortNumber } from "@/lib/scan/adapter";
import { formatCompactAge } from "@/lib/scan/format";
import { formatCompactNumber, cn } from "@/lib/utils";

export function OpenPositionsTable({
  positions,
  // Set from the full-screen modal opened via the up-arrow next to the
  // tabs — see TransfersList's matching prop for why: drops the
  // max-h-[280px] cap and the GlassPanel wrapper, since the modal already
  // provides both.
  expanded = false,
}: {
  positions: OpenPosition[];
  expanded?: boolean;
}) {
  const content = (
    <>
      {positions.length === 0 ? (
        <p className="text-xs text-ink-faint">No open positions in this scan window.</p>
      ) : (
        <div
          className={cn(
            "overflow-x-auto",
            // ~34px header + 15 rows at ~41px each — see TransfersList for
            // the same cap-height reasoning, just a taller row count here.
            !expanded && "max-h-[650px] overflow-y-auto",
          )}
        >
          <table className="w-full min-w-[480px] border-collapse text-sm">
            <thead>
              <tr className="sticky top-0 border-b border-line-strong bg-canvas/90 text-left text-[11px] uppercase tracking-wide text-ink-faint backdrop-blur">
                {/* box-shadow instead of divide-x/border-left here — see
                    TransfersList's matching comment: border-collapse drops
                    collapsed cell borders on a sticky row in Chromium. */}
                <th className="px-2 py-2 font-medium">Token</th>
                <th className="px-2 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  Quantity
                </th>
                <th className="px-2 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  Avg cost
                </th>
                <th className="px-4 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  Opened
                </th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p, i) => (
                <tr
                  key={`${p.token.address}-${p.quoteToken.address}-${i}`}
                  className="divide-x divide-line-strong border-b border-line-strong transition last:border-b-0 hover:bg-white/[0.02]"
                >
                  <td className="px-2 py-2.5 font-medium text-ink">{p.token.symbol}</td>
                  <td className="px-2 py-2.5 text-right text-ink-muted">{shortNumber(p.quantity)}</td>
                  <td
                    className="px-2 py-2.5 text-right text-ink-muted"
                    title={
                      p.avgCostUsd != null
                        ? `${shortNumber(p.avgCostQuote)} ${p.quoteToken.symbol}`
                        : undefined
                    }
                  >
                    {p.avgCostUsd != null
                      ? `$${shortNumber(p.avgCostUsd)}`
                      : `${shortNumber(p.avgCostQuote)} ${p.quoteToken.symbol}`}
                  </td>
                  <td className="px-4 py-2.5 text-right text-ink-faint">
                    {formatCompactAge(Math.max(0, Math.floor(Date.now() / 1000) - p.openedAt))} ago
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
        Open positions <span className="text-ink-faint">({formatCompactNumber(positions.length)})</span>
      </div>
      {content}
    </GlassPanel>
  );
}
