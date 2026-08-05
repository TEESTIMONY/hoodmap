"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight, X } from "lucide-react";
import { Chip } from "@/components/ui/Chip";
import type { Transfer, WalletGroup, WalletNode, WalletRole } from "@/lib/scan/types";
import { filterTransfersForWallet } from "@/lib/scan/wallet-transfers-filter";
import { shortNumber } from "@/lib/scan/adapter";
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

export function WalletDetailPanel({
  wallet,
  group,
  tokenPriceUsd,
  tokenSymbol,
  allTransfers,
  onClose,
}: {
  wallet: WalletNode;
  group?: WalletGroup;
  tokenPriceUsd?: number;
  tokenSymbol?: string;
  allTransfers: Transfer[];
  onClose: () => void;
}) {
  const [showTransfers, setShowTransfers] = useState(false);
  const entries = filterTransfersForWallet(allTransfers, wallet.id);
  const usdValue = tokenPriceUsd != null ? wallet.balance * tokenPriceUsd : undefined;

  return (
    <div className="mt-3 rounded-xl border border-line bg-white/[0.03] p-4 animate-fade-up">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-sm text-ink">{wallet.label ?? shortAddress(wallet.id)}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Chip
              icon={<span className={cn("h-1.5 w-1.5 rounded-full", ROLE_DOT_CLASS[wallet.role])} />}
            >
              {DETAIL_ROLE_LABEL[wallet.role]}
            </Chip>
            {group && <span className="text-[11px] text-ink-faint">In cluster: {group.label}</span>}
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

      <button
        onClick={() => setShowTransfers((v) => !v)}
        className="mt-3 flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-ink-muted transition hover:border-line-strong hover:text-ink"
      >
        Transfers <span className="text-ink-faint">({formatCompactNumber(entries.length)})</span>
      </button>

      {showTransfers && (
        <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border border-line">
          {entries.length === 0 ? (
            <p className="p-3 text-xs text-ink-faint">
              No transfers for this wallet in the current scan window.
            </p>
          ) : (
            <div className="flex flex-col divide-y divide-line">
              {entries.map((e, i) => (
                <div
                  key={`${e.transfer.hash}-${e.transfer.logIndex}-${i}`}
                  className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs"
                >
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                      e.direction === "in" ? "text-success bg-success/10" : "text-danger bg-danger/10",
                    )}
                  >
                    {e.direction === "in" ? (
                      <ArrowDownLeft className="h-3 w-3" />
                    ) : (
                      <ArrowUpRight className="h-3 w-3" />
                    )}
                    {e.direction === "in" ? "In" : "Out"}
                  </span>
                  <span className="font-mono text-ink-muted">{shortAddress(e.counterparty)}</span>
                  <span className="ml-auto text-ink">{shortNumber(e.transfer.amount)}</span>
                  <span className="w-full text-right text-[10px] text-ink-faint sm:w-auto">
                    {absoluteDateTime(e.transfer.ageSeconds)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
