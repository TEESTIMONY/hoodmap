"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronUp, Search, Wallet as WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Modal } from "@/components/ui/Modal";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { WalletIdentityCard, WalletStatsCard } from "@/components/wallet/WalletStatsHeader";
import { WalletHighlights } from "@/components/wallet/WalletHighlights";
import { OpenPositionsTable } from "@/components/wallet/OpenPositionsTable";
import { ClosedTradesTable } from "@/components/wallet/ClosedTradesTable";
import { WalletTransfersTable } from "@/components/wallet/WalletTransfersTable";
import { BubbleLoader } from "@/components/scan/BubbleLoader";
import { analyzeWalletServer } from "@/lib/scan/actions";
import { isPlausibleAddress, INVALID_WALLET_ADDRESS_MESSAGE, friendlyErrorMessage } from "@/lib/scan/validate";
import type { WalletPnlSummary } from "@/lib/scan/wallet-types";

// See the matching comment on the token scan page — analyzeWalletServer can
// take longer than a platform's default Server Action timeout for a very
// active wallet.
export const maxDuration = 300;

// Isolated so only THIS reads useSearchParams() — see the matching comment
// on the token scan page for why this needs its own Suspense boundary.
function AddressFromQuery({ onAddress }: { onAddress: (address: string) => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    const fromQuery = searchParams.get("address");
    if (fromQuery) onAddress(fromQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  return null;
}

type WalletTab = "positions" | "closed" | "transfers";

function walletTabs(data: WalletPnlSummary): TabItem[] {
  return [
    { id: "positions", label: "Open positions", count: data.openPositions.length },
    { id: "closed", label: "Closed trades", count: data.closedTrades.length },
    { id: "transfers", label: "Transfers", count: data.transfers.length },
  ];
}

const TAB_TITLE: Record<WalletTab, string> = {
  positions: "Open positions",
  closed: "Closed trades",
  transfers: "Transfers",
};

export default function WalletScanPage() {
  const [address, setAddress] = useState("");
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: WalletPnlSummary }
  >({ kind: "idle" });
  const [tab, setTab] = useState<WalletTab>("positions");
  // Same pattern as the token scan page's transactions expand button — the
  // up-arrow next to the tabs opens whichever tab is currently active in a
  // full-screen modal, instead of scrolling the in-page table (which is
  // capped at max-h-[280px] to keep the tables compact by default).
  const [tableExpanded, setTableExpanded] = useState(false);
  const ranFromQuery = useRef(false);

  async function runAnalysis(raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    // Checked here, before the server action is ever called, specifically
    // so a malformed address shows this exact friendly message instead of
    // an opaque "POST /wallet 500" — see lib/scan/validate.ts's comment
    // for why a server-side-only check isn't enough in production.
    if (!isPlausibleAddress(trimmed)) {
      setState({ kind: "error", message: INVALID_WALLET_ADDRESS_MESSAGE });
      return;
    }
    setState({ kind: "loading" });
    setTab("positions");
    setTableExpanded(false);
    try {
      const data = await analyzeWalletServer(trimmed);
      setState({ kind: "ready", data });
    } catch (err) {
      setState({
        kind: "error",
        message: friendlyErrorMessage(err, "Something went wrong loading this wallet. Please try again in a moment."),
      });
    }
  }

  function onAddressFromQuery(fromQuery: string) {
    if (ranFromQuery.current) return;
    ranFromQuery.current = true;
    setAddress(fromQuery);
    runAnalysis(fromQuery);
  }

  function onSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    runAnalysis(address);
  }

  const hasResult = state.kind === "ready";

  return (
    <div className="w-full px-4 pb-6 pt-3 md:px-6">
      <Suspense fallback={null}>
        <AddressFromQuery onAddress={onAddressFromQuery} />
      </Suspense>

      {/* No max-width cap once there's a result — see the matching comment
          on the token scan page for why: a fixed cap here would float this
          column with matching gutters on both sides the moment the browser
          is wider than it, while the header above has no cap at all. */}
      <div className={`mx-auto ${hasResult ? "w-full" : "max-w-3xl pt-[6vh]"}`}>
        {!hasResult && (
          <div className="mb-8 text-center animate-fade-up">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-lime to-moss shadow-[var(--shadow-glow-lime)]">
              <WalletIcon className="h-6 w-6 text-canvas" />
            </div>
            <h1 className="text-3xl font-medium tracking-tight text-ink md:text-4xl">
              Paste a wallet. See its trades.
            </h1>
            <p className="mt-3 text-sm text-ink-muted md:text-base">
              Total trades, win rate, and realized profit &amp; loss — reconstructed from real
              on-chain swaps across every token this wallet has touched, not just one.
            </p>
          </div>
        )}

        <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Paste a Robinhood Chain wallet address (0x…)"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-label="Robinhood Chain wallet address"
              className="h-14 w-full rounded-xl border border-line bg-white/[0.03] pl-11 pr-4 font-mono text-sm text-ink outline-none transition placeholder:font-sans placeholder:text-ink-faint focus:border-lime/50 focus:ring-2 focus:ring-lime/30"
            />
          </div>
          <Button
            type="submit"
            size="lg"
            disabled={state.kind === "loading" || !address.trim()}
            className="sm:w-40"
          >
            {state.kind === "loading" ? "Scanning…" : "Scan wallet"}
          </Button>
        </form>

        {state.kind === "loading" && (
          <div className="mt-6 flex flex-col items-center gap-4 text-center">
            <BubbleLoader />
            <p className="max-w-md text-xs text-ink-faint">
              Reading Robinhood Chain: scanning transfer history across every contract this wallet
              has touched, up to 5M blocks back, reconstructing trades, pricing swaps. This is a much
              wider and more thorough scan than a token scan, so it can take a few minutes for an
              active wallet.
            </p>
          </div>
        )}

        {state.kind === "error" && (
          <GlassPanel className="mt-4 border-danger/30 bg-danger/5 p-4 text-sm text-danger">
            {state.message}
          </GlassPanel>
        )}

        {state.kind === "ready" && (
          <div className="mt-3 flex flex-col gap-5">
            {/* Same DexScreener-style split as the token scan page: tabs +
                whichever tab's table on the left (absorbing all the width),
                identity/stats/highlights stacked in a fixed-width sidebar on
                the right. items-start keeps the sidebar from stretching to
                match the (usually taller) table column. */}
            <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="flex flex-col gap-5">
                <div className="flex items-center justify-between">
                  <Tabs tabs={walletTabs(state.data)} active={tab} onChange={(id) => setTab(id as WalletTab)} />
                  <button
                    type="button"
                    onClick={() => setTableExpanded(true)}
                    aria-label="Expand full table"
                    title="Expand full table"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-ink-faint transition hover:bg-white/[0.06] hover:text-ink"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </button>
                </div>

                <div className="animate-fade-up">
                  {tab === "positions" && <OpenPositionsTable positions={state.data.openPositions} />}
                  {tab === "closed" && <ClosedTradesTable trades={state.data.closedTrades} />}
                  {tab === "transfers" && <WalletTransfersTable transfers={state.data.transfers} />}
                </div>
              </div>

              <div className="flex flex-col gap-5">
                <WalletIdentityCard summary={state.data} />
                <WalletHighlights largestWin={state.data.largestWin} largestLoss={state.data.largestLoss} />
                <WalletStatsCard summary={state.data} />
              </div>
            </div>

            <GlassPanel className="p-4">
              <div className="mb-2 text-sm font-medium text-ink">About these numbers</div>
              <div className="flex flex-col gap-1.5 text-[11px] leading-relaxed text-ink-faint">
                {state.data.dataSources.notes.map((note, i) => (
                  <p key={i}>{note}</p>
                ))}
                <p>
                  Scanned blocks {state.data.dataSources.scanFromBlock.toLocaleString()}–
                  {state.data.dataSources.scanToBlock.toLocaleString()} (
                  {state.data.dataSources.scanBlocks.toLocaleString()} blocks). This is an
                  observational summary of blockchain data and does not constitute financial advice.
                </p>
              </div>
            </GlassPanel>

            <Modal open={tableExpanded} onClose={() => setTableExpanded(false)} title={TAB_TITLE[tab]}>
              {tab === "positions" && <OpenPositionsTable positions={state.data.openPositions} expanded />}
              {tab === "closed" && <ClosedTradesTable trades={state.data.closedTrades} expanded />}
              {tab === "transfers" && <WalletTransfersTable transfers={state.data.transfers} expanded />}
            </Modal>
          </div>
        )}
      </div>
    </div>
  );
}
