import { GlassPanel } from "@/components/ui/GlassPanel";
import type { ClosedTrade } from "@/lib/scan/wallet-types";
import { shortNumber } from "@/lib/scan/adapter";
import { formatCompactAge } from "@/lib/scan/format";
import { cn } from "@/lib/utils";

function TradeHighlight({
  label,
  trade,
  positive,
}: {
  label: string;
  trade?: ClosedTrade;
  positive: boolean;
}) {
  return (
    <GlassPanel className="p-4">
      <div className="text-sm font-medium text-ink">{label}</div>
      {!trade ? (
        <p className="mt-2 text-xs text-ink-faint">No {positive ? "winning" : "losing"} trades yet.</p>
      ) : (
        <div className="mt-2">
          <div className={cn("text-lg font-semibold", positive ? "text-success" : "text-danger")}>
            {positive ? "+" : ""}
            {shortNumber(trade.realizedPnlQuote)} {trade.quoteToken.symbol}
          </div>
          <div className="mt-1 text-xs text-ink-faint">
            {shortNumber(trade.quantity)} {trade.token.symbol} · bought at{" "}
            {shortNumber(trade.buyPriceInQuote)} sold at {shortNumber(trade.sellPriceInQuote)}{" "}
            {trade.quoteToken.symbol} · held {formatCompactAge(trade.holdSeconds)}
          </div>
        </div>
      )}
    </GlassPanel>
  );
}

export function WalletHighlights({
  largestWin,
  largestLoss,
}: {
  largestWin?: ClosedTrade;
  largestLoss?: ClosedTrade;
}) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      <TradeHighlight label="Largest win" trade={largestWin} positive />
      <TradeHighlight label="Largest loss" trade={largestLoss} positive={false} />
    </div>
  );
}
