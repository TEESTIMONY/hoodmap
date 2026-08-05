import { GlassPanel } from "@/components/ui/GlassPanel";
import type { OpenPosition } from "@/lib/scan/wallet-types";
import { shortNumber } from "@/lib/scan/adapter";
import { formatCompactAge } from "@/lib/scan/format";
import { formatCompactNumber } from "@/lib/utils";

export function OpenPositionsTable({ positions }: { positions: OpenPosition[] }) {
  return (
    <GlassPanel className="overflow-hidden p-4">
      <div className="mb-3 text-sm font-medium text-ink">
        Open positions <span className="text-ink-faint">({formatCompactNumber(positions.length)})</span>
      </div>
      {positions.length === 0 ? (
        <p className="text-xs text-ink-faint">No open positions in this scan window.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="px-2 py-2 font-medium">Token</th>
                <th className="px-2 py-2 text-right font-medium">Quantity</th>
                <th className="px-2 py-2 text-right font-medium">Avg cost</th>
                <th className="px-2 py-2 text-right font-medium">Opened</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p, i) => (
                <tr key={`${p.token.address}-${p.quoteToken.address}-${i}`} className="border-b border-line/60 last:border-0">
                  <td className="px-2 py-2.5 font-medium text-ink">{p.token.symbol}</td>
                  <td className="px-2 py-2.5 text-right text-ink-muted">{shortNumber(p.quantity)}</td>
                  <td className="px-2 py-2.5 text-right text-ink-muted">
                    {shortNumber(p.avgCostQuote)} {p.quoteToken.symbol}
                  </td>
                  <td className="px-2 py-2.5 text-right text-ink-faint">
                    {formatCompactAge(Math.max(0, Math.floor(Date.now() / 1000) - p.openedAt))} ago
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GlassPanel>
  );
}
