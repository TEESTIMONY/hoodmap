import { GlassPanel } from "@/components/ui/GlassPanel";
import { Chip } from "@/components/ui/Chip";
import type { WhaleRow } from "@/lib/scan/types";
import { shortAddress, formatCompactNumber } from "@/lib/utils";
import { shortNumber } from "@/lib/scan/adapter";
import { ROLE_DOT_CLASS } from "@/lib/scan/format";
import { cn } from "@/lib/utils";

// A high-supply token can give a real, nonzero % that rounds all the way to
// "0.00%" at 2 decimal places — indistinguishable at a glance from a
// literal 0, which reads as broken. "<0.01%" makes clear it's real but
// small, rather than nothing.
function formatPct(pct: number): string {
  if (pct > 0 && pct < 0.01) return "<0.01%";
  return `${pct.toFixed(2)}%`;
}

export function WhaleTable({ whales }: { whales: WhaleRow[] }) {
  return (
    <GlassPanel className="overflow-hidden p-4">
      <div className="mb-1 text-sm font-medium text-ink">Whale intelligence</div>
      <p className="mb-3 text-[11px] text-ink-faint">
        These are the largest holders among wallets active in the recent scan window — this chain
        has no full holder index, so a long-time holder who simply hasn't transacted recently won't
        appear here even if they hold a lot. For a high-supply token, an individual recently-active
        wallet's true % can legitimately round to 0.00% without anything being wrong.
      </p>
      {whales.length === 0 ? (
        <p className="text-xs text-ink-faint">No whale-sized holders observed in this window.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-faint">
                <th className="px-2 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">Wallet</th>
                <th className="px-2 py-2 font-medium">Labels</th>
                <th className="px-2 py-2 text-right font-medium">% supply</th>
                <th className="px-2 py-2 text-right font-medium">ETH balance</th>
                <th className="px-2 py-2 text-right font-medium">Links</th>
                <th className="px-4 py-2 text-right font-medium">Txs</th>
              </tr>
            </thead>
            <tbody>
              {whales.map((w) => (
                <tr key={w.address} className="border-b border-line/60 transition last:border-0 hover:bg-white/[0.02]">
                  <td className="px-2 py-2.5 text-ink-faint">{w.rank != null ? `#${w.rank}` : "—"}</td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", ROLE_DOT_CLASS[w.role])} />
                      <span className="font-mono text-xs text-ink">{shortAddress(w.address)}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {w.labels.map((l) => (
                        <Chip key={l} className="px-2 py-0.5 text-[10px]">
                          {l}
                        </Chip>
                      ))}
                    </div>
                  </td>
                  <td className="px-2 py-2.5 text-right text-ink-muted">{formatPct(w.pctSupply)}</td>
                  <td className="px-2 py-2.5 text-right text-ink-muted">
                    {w.nativeBalance == null ? (
                      <span className="text-ink-faint">unavailable</span>
                    ) : (
                      `${shortNumber(w.nativeBalance)} ETH`
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right text-ink-faint">{formatCompactNumber(w.connectedWallets)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-faint">{formatCompactNumber(w.recentTxs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GlassPanel>
  );
}
