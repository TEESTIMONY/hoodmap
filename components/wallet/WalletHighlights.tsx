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
  const hasUsd = trade?.realizedPnlUsd != null;
  return (
    <GlassPanel className="p-4">
      <div className="text-sm font-medium text-ink">{label}</div>
      {!trade ? (
        <p className="mt-2 text-xs text-ink-faint">No {positive ? "winning" : "losing"} trades yet.</p>
      ) : (
        <div className="mt-2">
          <div className={cn("text-lg font-semibold", positive ? "text-success" : "text-danger")}>
            {hasUsd
              ? `${positive ? "+" : ""}$${shortNumber(Math.abs(trade.realizedPnlUsd!))}`
              : `${positive ? "+" : ""}${shortNumber(trade.realizedPnlQuote)} ${trade.quoteToken.symbol}`}
          </div>
          <div className="mt-1 text-xs text-ink-faint">
            {hasUsd && (
              <>
                {positive ? "+" : ""}
                {shortNumber(trade.realizedPnlQuote)} {trade.quoteToken.symbol} ·{" "}
              </>
            )}
            {shortNumber(trade.quantity)} {trade.token.symbol} · bought at{" "}
            {trade.buyPriceUsd != null ? `$${shortNumber(trade.buyPriceUsd)}` : shortNumber(trade.buyPriceInQuote)}{" "}
            sold at{" "}
            {trade.sellPriceUsd != null
              ? `$${shortNumber(trade.sellPriceUsd)}`
              : `${shortNumber(trade.sellPriceInQuote)} ${trade.quoteToken.symbol}`}{" "}
            · held {formatCompactAge(trade.holdSeconds)}
          </div>
        </div>
      )}
    </GlassPanel>
  );
}

// Always a single column now (not sm:grid-cols-2) — this lives in the
// scan sidebar's narrow, fixed-width column, same as ScoreCard, so it's
// the column's own width that decides whether two fit side by side, not
// the viewport's. At ~320px they don't.
export function WalletHighlights({
  largestWin,
  largestLoss,
}: {
  largestWin?: ClosedTrade;
  largestLoss?: ClosedTrade;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <TradeHighlight label="Largest win" trade={largestWin} positive />
      <TradeHighlight label="Largest loss" trade={largestLoss} positive={false} />
    </div>
  );
}
