import { GlassPanel } from "@/components/ui/GlassPanel";
import type { ClosedTrade } from "@/lib/scan/wallet-types";
import { shortNumber } from "@/lib/scan/adapter";
import { formatAge, formatCompactAge } from "@/lib/scan/format";
import { formatCompactNumber, cn } from "@/lib/utils";

const MAX_ROWS = 100;

export function ClosedTradesTable({
  trades,
  // See OpenPositionsTable / TransfersList's matching prop.
  expanded = false,
}: {
  trades: ClosedTrade[];
  expanded?: boolean;
}) {
  const rows = trades.slice(0, MAX_ROWS);

  const content = (
    <>
      {trades.length === 0 ? (
        <p className="text-xs text-ink-faint">
          No closed trades priced against a recognized reference asset in this scan window.
        </p>
      ) : (
        <div
          className={cn("overflow-x-auto", !expanded && "max-h-[650px] overflow-y-auto")}
        >
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="sticky top-0 border-b border-line-strong bg-canvas/90 text-left text-[11px] uppercase tracking-wide text-ink-faint backdrop-blur">
                <th className="px-2 py-2 font-medium">Token</th>
                <th className="px-2 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  Quote
                </th>
                <th className="px-2 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  Quantity
                </th>
                <th className="px-2 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  Buy price
                </th>
                <th className="px-2 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  Sell price
                </th>
                <th className="px-2 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  PnL
                </th>
                <th className="px-2 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  Held
                </th>
                <th className="px-4 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  Closed
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => {
                const win = t.realizedPnlQuote >= 0;
                return (
                  <tr
                    key={`${t.sellTxHash}-${i}`}
                    className="divide-x divide-line-strong border-b border-line-strong transition last:border-b-0 hover:bg-white/[0.02]"
                  >
                    <td className="px-2 py-2.5 font-medium text-ink">{t.token.symbol}</td>
                    <td className="px-2 py-2.5 text-right text-ink-faint">{t.quoteToken.symbol}</td>
                    <td className="px-2 py-2.5 text-right text-ink-muted">{shortNumber(t.quantity)}</td>
                    <td
                      className="px-2 py-2.5 text-right text-ink-muted"
                      title={t.buyPriceUsd != null ? `${shortNumber(t.buyPriceInQuote)} ${t.quoteToken.symbol}` : undefined}
                    >
                      {t.buyPriceUsd != null ? `$${shortNumber(t.buyPriceUsd)}` : shortNumber(t.buyPriceInQuote)}
                    </td>
                    <td
                      className="px-2 py-2.5 text-right text-ink-muted"
                      title={t.sellPriceUsd != null ? `${shortNumber(t.sellPriceInQuote)} ${t.quoteToken.symbol}` : undefined}
                    >
                      {t.sellPriceUsd != null ? `$${shortNumber(t.sellPriceUsd)}` : shortNumber(t.sellPriceInQuote)}
                    </td>
                    <td
                      className={cn("px-2 py-2.5 text-right font-medium", win ? "text-success" : "text-danger")}
                      title={
                        t.realizedPnlUsd != null
                          ? `${win ? "+" : ""}${shortNumber(t.realizedPnlQuote)} ${t.quoteToken.symbol}`
                          : undefined
                      }
                    >
                      {win ? "+" : ""}
                      {t.realizedPnlUsd != null
                        ? `$${shortNumber(Math.abs(t.realizedPnlUsd))}`
                        : `${shortNumber(t.realizedPnlQuote)} ${t.quoteToken.symbol}`}
                    </td>
                    <td className="px-2 py-2.5 text-right text-ink-faint">{formatCompactAge(t.holdSeconds)}</td>
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
    </>
  );

  if (expanded) return content;

  return (
    <GlassPanel className="overflow-hidden p-4">
      <div className="mb-3 text-sm font-medium text-ink">
        Closed trades <span className="text-ink-faint">({formatCompactNumber(trades.length)})</span>
      </div>
      {content}
    </GlassPanel>
  );
}
