"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ChevronDown, X } from "lucide-react";
import type { Transfer, WalletGroup, WalletNode, WalletRole } from "@/lib/scan/types";
import { filterTransfersForWallet } from "@/lib/scan/wallet-transfers-filter";
import { shortNumber } from "@/lib/scan/adapter";
import { bubbleColorCss, NEUTRAL_BUBBLE_COLOR, type BubbleColor } from "@/lib/scan/hoodmap-layout";
import { ROLE_DOT_CLASS } from "@/lib/scan/format";
import { cn, formatCompactNumber, shortAddress } from "@/lib/utils";

// Wording matches the task's literal spec for the common roles; the
// remaining WalletRole values fall back to a plain capitalized label so
// nothing renders blank if one shows up in the top holders.
const DETAIL_ROLE_LABEL: Record<WalletRole, string> = {
  developer: "Deployer",
  liquidity: "Liquidity Pool",
  exchange: "Exchange",
  whale: "Whale",
  holder: "Holder",
  sniper: "Sniper",
  insider: "Insider",
  burn: "Burn Address",
  contract: "Contract",
};

function absoluteDateTime(ageSeconds: number): string {
  const date = new Date(Date.now() - ageSeconds * 1000);
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// Small dark pill — matches this panel's bottom tag row (role, transfer
// count) to a reference bubble map's "EOA" / "N Transfers" tag style:
// flat, low-contrast, icon-optional, not a colored Chip.
function Pill({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-ink-muted">
      {icon}
      {children}
    </span>
  );
}

export function WalletDetailPanel({
  wallet,
  group,
  clusterColor,
  tokenPriceUsd,
  tokenSymbol,
  allTransfers,
  onClose,
}: {
  wallet: WalletNode;
  group?: WalletGroup;
  clusterColor?: BubbleColor;
  tokenPriceUsd?: number;
  tokenSymbol?: string;
  allTransfers: Transfer[];
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<"in" | "out" | null>(null);
  const entries = filterTransfersForWallet(allTransfers, wallet.id);
  const usdValue = tokenPriceUsd != null ? wallet.balance * tokenPriceUsd : undefined;

  // Aggregated IN/OUT — total amount plus how many distinct counterparty
  // addresses it came from/went to, not just a raw transfer count. Matches
  // how a reference bubble map summarizes a node's flow at a glance, with
  // the full per-transfer list still available by expanding either side.
  const inEntries = entries.filter((e) => e.direction === "in");
  const outEntries = entries.filter((e) => e.direction === "out");
  const inTotal = inEntries.reduce((s, e) => s + e.transfer.amount, 0);
  const outTotal = outEntries.reduce((s, e) => s + e.transfer.amount, 0);
  const inAddressCount = new Set(inEntries.map((e) => e.counterparty.toLowerCase())).size;
  const outAddressCount = new Set(outEntries.map((e) => e.counterparty.toLowerCase())).size;
  const inUsd = tokenPriceUsd != null ? inTotal * tokenPriceUsd : undefined;
  const outUsd = tokenPriceUsd != null ? outTotal * tokenPriceUsd : undefined;

  const formatFlow = (amount: number, usd?: number) =>
    usd != null ? `$${shortNumber(usd)}` : `${shortNumber(amount)} ${tokenSymbol ?? ""}`;

  return (
    <div className="mt-3 rounded-xl border border-line bg-white/[0.03] p-4 animate-fade-up">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {wallet.rank != null && (
              <span className="rounded-full bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-ink-faint">
                #{wallet.rank}
              </span>
            )}
            <div className="font-mono text-sm text-ink">{wallet.label ?? shortAddress(wallet.id)}</div>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close wallet details"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-faint transition hover:bg-white/[0.06] hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        <div className="rounded-lg bg-white/[0.03] px-3 py-2">
          <div className="text-sm font-semibold text-ink">{wallet.pctSupply.toFixed(2)}%</div>
          <div className="text-[11px] text-ink-faint">Of supply</div>
        </div>
        <div className="rounded-lg bg-white/[0.03] px-3 py-2">
          <div className="text-sm font-semibold text-ink">
            {shortNumber(wallet.balance)} {tokenSymbol ?? ""}
          </div>
          <div className="text-[11px] text-ink-faint">Amount held</div>
        </div>
        <div className="rounded-lg bg-white/[0.03] px-3 py-2">
          <div className="text-sm font-semibold text-ink">
            {usdValue != null ? `$${shortNumber(usdValue)}` : "—"}
          </div>
          <div className="text-[11px] text-ink-faint">USD value</div>
        </div>
      </div>

      {group && (
        <div className="mt-2.5 flex items-center justify-between rounded-lg bg-white/[0.04] px-3 py-2">
          <span className="text-xs text-ink-muted">
            Cluster Supply: <span className="font-semibold text-ink">{group.pctSupply.toFixed(2)}%</span>
            <span className="ml-1.5 text-ink-faint">({group.label})</span>
          </span>
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ background: bubbleColorCss(clusterColor ?? NEUTRAL_BUBBLE_COLOR) }}
          />
        </div>
      )}

      <div className="mt-2.5 flex flex-col gap-1.5">
        {(
          [
            { dir: "in" as const, entries: inEntries, total: inTotal, usd: inUsd, addrCount: inAddressCount },
            { dir: "out" as const, entries: outEntries, total: outTotal, usd: outUsd, addrCount: outAddressCount },
          ] as const
        ).map((row) => (
          <div key={row.dir} className="rounded-lg border border-line">
            <button
              onClick={() => setExpanded((cur) => (cur === row.dir ? null : row.dir))}
              disabled={row.entries.length === 0}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition hover:bg-white/[0.03] disabled:cursor-default disabled:hover:bg-transparent"
            >
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                  row.dir === "in" ? "text-success bg-success/10" : "text-danger bg-danger/10",
                )}
              >
                {row.dir === "in" ? (
                  <ArrowDownLeft className="h-3 w-3" />
                ) : (
                  <ArrowUpRight className="h-3 w-3" />
                )}
                {formatFlow(row.total, row.usd)}
              </span>
              <span className="text-ink-faint">
                {row.dir === "in" ? "from" : "to"} {row.addrCount} address{row.addrCount === 1 ? "" : "es"}
              </span>
              {row.entries.length > 0 && (
                <ChevronDown
                  className={cn(
                    "ml-auto h-3.5 w-3.5 text-ink-faint transition-transform",
                    expanded === row.dir && "rotate-180",
                  )}
                />
              )}
            </button>
            {expanded === row.dir && (
              <div className="max-h-56 overflow-y-auto border-t border-line">
                <div className="flex flex-col divide-y divide-line">
                  {row.entries.map((e, i) => (
                    <div
                      key={`${e.transfer.hash}-${e.transfer.logIndex}-${i}`}
                      className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs"
                    >
                      <span className="font-mono text-ink-muted">{shortAddress(e.counterparty)}</span>
                      <span className="ml-auto text-ink">{shortNumber(e.transfer.amount)}</span>
                      <span className="w-full text-right text-[10px] text-ink-faint sm:w-auto">
                        {absoluteDateTime(e.transfer.ageSeconds)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Pill icon={<span className={cn("h-1.5 w-1.5 rounded-full", ROLE_DOT_CLASS[wallet.role])} />}>
          {DETAIL_ROLE_LABEL[wallet.role]}
        </Pill>
        <Pill>{formatCompactNumber(entries.length)} Transfers</Pill>
      </div>
    </div>
  );
}
