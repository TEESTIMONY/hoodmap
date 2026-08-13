import { ArrowDownRight, ArrowLeftRight, ArrowUpRight, ExternalLink, Flame, Sparkles } from "lucide-react";
import { GlassPanel } from "@/components/ui/GlassPanel";
import type { Transfer } from "@/lib/scan/types";
import { shortAddress } from "@/lib/utils";
import { shortNumber } from "@/lib/scan/adapter";
import { formatAge } from "@/lib/scan/format";
import { cn } from "@/lib/utils";

// Robinhood Chain's Blockscout-backed public explorer — confirmed live
// (returns a 301 on /tx/<hash>, the expected redirect-to-canonical-case
// behavior for a real tx route) rather than assumed from the API host name.
const EXPLORER_TX_URL = "https://explorer.mainnet.chain.robinhood.com/tx/";

const KIND_STYLE: Record<Transfer["kind"], string> = {
  buy: "text-success bg-success/10",
  sell: "text-danger bg-danger/10",
  mint: "text-moss-soft bg-moss/10",
  burn: "text-ink-faint bg-white/[0.05]",
  transfer: "text-ink-muted bg-white/[0.05]",
};

const KIND_ICON: Record<Transfer["kind"], typeof ArrowUpRight> = {
  buy: ArrowUpRight,
  sell: ArrowDownRight,
  mint: Sparkles,
  burn: Flame,
  transfer: ArrowLeftRight,
};

const AMOUNT_COLOR: Record<Transfer["kind"], string> = {
  buy: "text-success",
  sell: "text-danger",
  mint: "text-moss-soft",
  burn: "text-ink-faint",
  transfer: "text-ink",
};

export function TransfersList({
  transfers,
  tokenPriceUsd,
  // Set from the full-screen modal opened via the up-arrow next to the
  // tabs: drops the max-h-[480px] cap (the modal's own scroll container
  // handles that instead) and skips the GlassPanel wrapper, since the
  // modal already renders one — nesting them would double up the
  // border/background and the padding.
  expanded = false,
}: {
  transfers: Transfer[];
  // Only the token's CURRENT price, not what it was worth at each transfer's
  // own block — there's no historical price feed wired up here. The USD
  // column is a "worth this much at today's price" figure, not a trade-time
  // valuation, which is why it's the same multiplier on every row.
  tokenPriceUsd?: number;
  expanded?: boolean;
}) {
  const content = (
    <>
      {transfers.length === 0 ? (
        <p className="text-xs text-ink-faint">No transfers observed in this scan window.</p>
      ) : (
        <div
          className={cn(
            "overflow-x-auto",
            // ~34px header + 6 rows at ~41px each (py-2.5 + text-sm + the
            // row's own border-b) — capping here instead of at an arbitrary
            // pixel count means exactly 6 rows show before the rest need a
            // scroll, matching the header row's own height so it doesn't
            // clip mid-row.
            !expanded && "max-h-[280px] overflow-y-auto",
          )}
        >
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="sticky top-0 border-b border-line-strong bg-canvas/90 text-left text-[11px] uppercase tracking-wide text-ink-faint backdrop-blur">
                {/* Vertical dividers here use box-shadow instead of the
                    divide-x/border-left the body rows use — border-collapse
                    drops collapsed cell borders on a sticky row in Chromium,
                    so the same border-based divider silently disappeared
                    only on this header. box-shadow paints independently of
                    both border-collapse and sticky positioning. */}
                <th className="px-2 py-2 font-medium">Age</th>
                <th className="px-2 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  Type
                </th>
                <th className="px-2 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  Amount
                </th>
                <th className="px-2 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  USD
                </th>
                <th className="px-2 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  From
                </th>
                <th className="px-2 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  To
                </th>
                <th className="px-4 py-2 text-right font-medium shadow-[inset_1px_0_0_var(--color-line-strong)]">
                  Txn
                </th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t) => {
                const Icon = KIND_ICON[t.kind];
                const usd = tokenPriceUsd != null ? t.amount * tokenPriceUsd : null;
                return (
                  <tr
                    key={`${t.hash}-${t.logIndex}`}
                    className="divide-x divide-line-strong border-b border-line-strong transition last:border-b-0 hover:bg-white/[0.02]"
                  >
                    <td className="px-2 py-2.5 whitespace-nowrap text-ink-faint">{formatAge(t.ageSeconds)}</td>
                    <td className="px-2 py-2.5 text-right">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
                          KIND_STYLE[t.kind],
                        )}
                      >
                        <Icon className="h-3 w-3" />
                        {t.kind}
                      </span>
                    </td>
                    <td className={cn("px-2 py-2.5 text-right", AMOUNT_COLOR[t.kind])}>{shortNumber(t.amount)}</td>
                    <td className="px-2 py-2.5 text-right text-ink-muted">
                      {usd != null ? `$${shortNumber(usd)}` : "—"}
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono text-xs text-ink-muted">
                      {shortAddress(t.from)}
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono text-xs text-ink-muted">
                      {shortAddress(t.to)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <a
                        href={`${EXPLORER_TX_URL}${t.hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="View transaction on the block explorer"
                        className="inline-flex text-ink-faint transition hover:text-lime-soft"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
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

  return <GlassPanel className="overflow-hidden p-4">{content}</GlassPanel>;
}
