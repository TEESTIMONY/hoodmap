// Pure per-wallet transfer filtering for the HoodMap detail panel. Filters
// the already-scanned token-wide transfer list (AnalysisResult.allTransfers)
// down to one wallet — no on-chain query of its own.

import type { Transfer } from "./types";

export interface WalletTransferEntry {
  transfer: Transfer;
  direction: "in" | "out";
  counterparty: string;
}

/**
 * A self-transfer (from === to === the target wallet) is emitted once, as
 * "out", rather than twice — it's a single on-chain event, and double-
 * counting it would inflate both "in" and "out" activity for a wallet that
 * happens to send itself its own token.
 */
export function filterTransfersForWallet(
  transfers: Transfer[],
  wallet: string,
): WalletTransferEntry[] {
  const target = wallet.trim().toLowerCase();
  if (!target) return [];

  const entries: WalletTransferEntry[] = [];
  for (const transfer of transfers) {
    const from = transfer.from.toLowerCase();
    const to = transfer.to.toLowerCase();
    if (from === target) {
      entries.push({ transfer, direction: "out", counterparty: transfer.to });
    } else if (to === target) {
      entries.push({ transfer, direction: "in", counterparty: transfer.from });
    }
  }

  // Smaller ageSeconds = more recently observed; most recent first.
  return entries.sort((a, b) => a.transfer.ageSeconds - b.transfer.ageSeconds);
}
