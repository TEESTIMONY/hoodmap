import { GlassPanel } from "@/components/ui/GlassPanel";
import type { ClosedTrade } from "@/lib/scan/wallet-types";
import { shortNumber } from "@/lib/scan/adapter";
import { formatAge, formatCompactAge } from "@/lib/scan/format";
import { formatCompactNumber, cn } from "@/lib/utils";

const MAX_ROWS = 100;

export function ClosedTradesTable({ trades }: { trades: ClosedTrade[] }) {
  const rows = trades.slice(0, MAX_ROWS);

  return (
    <GlassPanel className="overflow-hidden p-4">
      <div className="mb-3 text-sm font-medium text-ink">
        Closed trades <span className="text-ink-faint">({formatCompactNumber(trades.length)})</span>
      </div>
      {trades.length === 0 ? (
        <p className="text-xs text-ink-faint">
          No closed trades priced against a recognized reference asset in this scan window.
        </p>
      ) : (
        <div className="max-h-[480px] overflow-y-auto overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="sticky top-0 border-b border-line bg-canvas/90 text-left text-[11px] uppercase tracking-wide text-ink-faint backdrop-blur">
                <th className="px-2 py-2 font-medium">Token</th>
                <th className="px-2 py-2 font-medium">Quote</th>
                <th className="px-2 py-2 text-right font-medium">Quantity</th>
                <th className="px-2 py-2 text-right font-medium">Buy price</th>
                <th className="px-2 py-2 text-right font-medium">Sell price</th>
                <th className="px-2 py-2 text-right font-medium">PnL</th>
                <th className="px-2 py-2 text-right font-medium">Held</th>
                <th className="px-4 py-2 text-right font-medium">Closed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => {
                const win = t.realizedPnlQuote >= 0;
                return (
                  <tr key={`${t.sellTxHash}-${i}`} className="border-b border-line/60 last:border-0">
                    <td className="px-2 py-2.5 font-medium text-ink">{t.token.symbol}</td>
                    <td className="px-2 py-2.5 text-ink-faint">{t.quoteToken.symbol}</td>
                    <td className="px-2 py-2.5 text-right text-ink-muted">{shortNumber(t.quantity)}</td>
                    <td className="px-2 py-2.5 text-right text-ink-muted">
                      {shortNumber(t.buyPriceInQuote)}
                    </td>
                    <td className="px-2 py-2.5 text-right text-ink-muted">
                      {shortNumber(t.sellPriceInQuote)}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-2.5 text-right font-medium",
                        win ? "text-success" : "text-danger",
                      )}
                    >
                      {win ? "+" : ""}
                      {shortNumber(t.realizedPnlQuote)} {t.quoteToken.symbol}
                    </td>
                    <td className="px-2 py-2.5 text-right text-ink-faint">
                      {formatCompactAge(t.holdSeconds)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-ink-faint">
                      {formatAge(Math.max(0, Math.floor(Date.now() / 1000) - t.sellTimestamp))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </GlassPanel>
  );
}
