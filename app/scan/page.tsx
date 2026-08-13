"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp, Search, ScanLine, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Modal } from "@/components/ui/Modal";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { TokenHeader } from "@/components/scan/TokenHeader";
import { TokenChart } from "@/components/scan/TokenChart";
import { TokenStatsCard } from "@/components/scan/TokenStatsCard";
import { ScoreCard } from "@/components/scan/ScoreCard";
import { WarningsBanner } from "@/components/scan/WarningsBanner";
import { HealthGrid } from "@/components/scan/HealthGrid";
import { HolderDistribution } from "@/components/scan/HolderDistribution";
import { WhaleTable } from "@/components/scan/WhaleTable";
import { ClusterCards } from "@/components/scan/ClusterCards";
import { HoodMapView } from "@/components/scan/HoodMapView";
import { BubbleLoader } from "@/components/scan/BubbleLoader";
import { TransfersList } from "@/components/scan/TransfersList";
import { SummaryFooter } from "@/components/scan/SummaryFooter";
import { TopTokens } from "@/components/scan/TopTokens";
import { analyzeToken, type ProgressStep } from "@/lib/scan/adapter";
import { friendlyErrorMessage } from "@/lib/scan/validate";
import type { AnalysisResult } from "@/lib/scan/types";

// Extends the Server Action timeout for this page beyond whatever a
// deployment platform defaults to (e.g. Vercel's Hobby-tier default is
// 10s) — analyzeTokenServer can legitimately take longer than that for an
// active token. Platforms cap this to whatever their own plan allows, so
// requesting more than a given tier permits is harmless, not an error.
export const maxDuration = 300;

const STEPS: { key: ProgressStep; label: string }[] = [
  { key: "validating", label: "Validate contract" },
  { key: "onchain", label: "Read Robinhood Chain" },
  { key: "market", label: "Fetch market data" },
  { key: "rendering", label: "Compute intelligence" },
];

// "Overview" was dropped as a tab — HealthGrid/HolderDistribution/
// ClusterCards now live permanently in the sidebar next to the chart (see
// below), so a tab that just re-showed the same three cards full-width
// would've been pure duplication. "HoodMap" stays in this list (it still
// needs to render as a tab-styled button) but clicking it opens a modal
// instead of switching `tab` — see the onChange handler below.
function scanTabs(data: AnalysisResult): TabItem[] {
  return [
    { id: "transactions", label: "Transactions", count: data.transfers.length },
    { id: "map", label: "HoodMap", count: data.graph.nodes.length },
    { id: "whales", label: "Whales", count: data.whales.length },
    { id: "summary", label: "Summary" },
  ];
}

// Isolated so only THIS reads useSearchParams() — it needs a Suspense
// boundary to be statically prerendered, and scoping that boundary to a
// null-rendering helper (instead of wrapping the whole page) means the rest
// of Scan still renders in the static HTML shell instead of bailing out to
// client-only rendering.
function AddressFromQuery({ onAddress }: { onAddress: (address: string) => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    const fromQuery = searchParams.get("address");
    if (fromQuery) onAddress(fromQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  return null;
}

type ScanTab = "whales" | "transactions" | "summary";

export default function ScanPage() {
  const [address, setAddress] = useState("");
  const [progress, setProgress] = useState<ProgressStep | null>(null);
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: AnalysisResult }
  >({ kind: "idle" });
  const [tab, setTab] = useState<ScanTab>("transactions");
  // HoodMap opens as a popup instead of an in-place tab switch — its graph
  // is tall enough that switching to it in the normal tab area meant
  // scrolling back up just to see it, since the chart/sidebar above stayed
  // put. A modal keeps it reachable without that scroll.
  const [mapOpen, setMapOpen] = useState(false);
  // Same popup pattern for the transactions table — the up-arrow next to
  // the tabs opens the full list in a modal instead of scrolling the
  // in-page table (which is capped at max-h-[480px] to keep the page from
  // growing past the viewport; the modal is where you go to actually scan
  // the whole list).
  const [transactionsExpanded, setTransactionsExpanded] = useState(false);
  // Open by default so first-time visitors still see trending tokens for
  // discovery; collapses the moment a scan is run, since the results
  // themselves are the focus at that point — reopen anytime via the toggle.
  const [topTokensOpen, setTopTokensOpen] = useState(true);
  const ranFromQuery = useRef(false);

  async function runAnalysis(raw: string) {
    if (!raw.trim()) return;
    setState({ kind: "loading" });
    setTab("transactions");
    setMapOpen(false);
    setTopTokensOpen(false);
    setProgress("validating");
    try {
      const data = await analyzeToken(raw, (u) => setProgress(u.step));
      setState({ kind: "ready", data });
      setProgress(null);
    } catch (err) {
      setState({
        kind: "error",
        message: friendlyErrorMessage(err, "Something went wrong scanning this token. Please try again in a moment."),
      });
      setProgress(null);
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

  // Below lg (and always for the idle/loading/error states, regardless of
  // width) this page is normal document flow — AppShell's <main> scrolls
  // it like any other page. Only at lg+ with a result does it opt into a
  // locked-to-the-viewport layout with exactly one scrolling region (the
  // sidebar): h-full here resolves against AppShell's <main>, which is now
  // a definite, fixed-height flex box (see AppShell.tsx) rather than a
  // guessed `calc(100vh-Npx)` — that guesswork is what kept leaving a
  // sliver of page-level scroll behind on previous attempts.
  const resultLayoutClass = hasResult ? "lg:flex lg:h-full lg:flex-col lg:overflow-hidden" : "";

  return (
    <div className={`w-full px-4 pb-6 pt-3 md:px-6 ${resultLayoutClass}`}>
      <Suspense fallback={null}>
        <AddressFromQuery onAddress={onAddressFromQuery} />
      </Suspense>

      <div
        // No max-width cap once there's a result: the header above this
        // (search bar, connect wallet) spans the full main column with no
        // cap of its own, so a fixed max-w here — even a fairly wide one —
        // reads as a shrunken column with matching gutters on both sides
        // the moment the browser is wider than that cap. Letting it go
        // edge-to-edge (mx-auto is a no-op without a max-width, kept only
        // so the idle state below still centers) matches the header and
        // uses the same width we already earned back from the sidebar/tab
        // trims earlier in this conversation.
        className={`mx-auto ${
          hasResult ? `w-full ${resultLayoutClass} lg:min-h-0` : "max-w-3xl pt-[6vh]"
        }`}
      >
        {!hasResult && (
          <div className="mb-8 text-center animate-fade-up">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-lime to-moss shadow-[var(--shadow-glow-lime)]">
              <ScanLine className="h-6 w-6 text-canvas" />
            </div>
            <h1 className="text-3xl font-medium tracking-tight text-ink md:text-4xl">
              Paste a contract. See the wallets.
            </h1>
            <p className="mt-3 text-sm text-ink-muted md:text-base">
              Live Robinhood Chain intelligence: real holder distribution, connected wallet
              clusters, a HoodScore, and whale intelligence — pulled straight from on-chain
              transfers.
            </p>
          </div>
        )}

        <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Paste a Robinhood Chain contract address (0x…)"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-label="Robinhood Chain contract address"
              className="h-14 w-full rounded-xl border border-line bg-white/[0.03] pl-11 pr-4 font-mono text-sm text-ink outline-none transition placeholder:font-sans placeholder:text-ink-faint focus:border-lime/50 focus:ring-2 focus:ring-lime/30"
            />
          </div>
          <Button
            type="submit"
            size="lg"
            disabled={state.kind === "loading" || !address.trim()}
            className="sm:w-40"
          >
            {state.kind === "loading" ? "Scanning…" : "Scan"}
          </Button>
        </form>

        {state.kind === "loading" && (
          <div className="mt-6 flex flex-col items-center gap-4 text-center">
            <BubbleLoader />
            <p className="max-w-md text-xs text-ink-faint">
              Reading Robinhood Chain across the last 50,000 blocks (~1.15 days) to find real wallet
              clusters and holders, not just the last few hours — an active token can take a while
              to fully scan.
            </p>
          </div>
        )}

        {state.kind === "loading" && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {STEPS.map((step, i) => {
              const stepIndex = STEPS.findIndex((s) => s.key === progress);
              const done = stepIndex > i;
              const active = step.key === progress;
              return (
                <span
                  key={step.key}
                  className={`rounded-full border px-3 py-1.5 text-xs transition ${
                    active
                      ? "border-lime/40 bg-lime/10 text-lime-soft"
                      : done
                        ? "border-line text-ink-faint"
                        : "border-line text-ink-faint/50"
                  }`}
                >
                  {step.label}
                </span>
              );
            })}
          </div>
        )}

        {state.kind === "error" && (
          <GlassPanel className="mt-4 border-danger/30 bg-danger/5 p-4 text-sm text-danger">
            {state.message}
          </GlassPanel>
        )}

        {state.kind === "ready" && (
          <div className="mt-3 flex flex-col gap-5 lg:min-h-0 lg:flex-1">
            {/* Token identity now lives only in the sidebar (below) — this
                page-level copy was dropped rather than kept as a second,
                duplicate spot for the same name/avatar/address. */}
            <WarningsBanner warnings={state.data.warnings} />

            {/* DexScreener-style arrangement: chart + tabs + whichever tab's
                content all stack together in one left column, so
                Transactions sits directly under the chart with no gap, at
                the chart's own width — not full page width. The sidebar
                (HoodScore, health, holders, clusters) is the other column,
                and stacks to whatever height it needs on its own;
                items-start keeps these two columns from stretching to match
                each other (the default grid behavior), which previously
                left a tall blank gap in the left column once the sidebar —
                now 4 cards deep — grew past the chart's own height.
                The sidebar gets a fixed width rather than a fraction of the
                grid — its cards (stats, score, health) don't need to grow
                with the page, and a percentage split was wasting width on
                them at this container's 1800px cap; the chart/tabs/table
                column absorbs all the remaining space instead. */}
            <div className="grid grid-cols-1 items-start gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="flex flex-col gap-5">
                {/* Tighter gap than the flex-col's own gap-5 specifically
                    between the chart and the tab bar right below it — that
                    pairing reads as one unit (chart, then the tabs that
                    control what's under it), so the wider gap-5 rhythm used
                    everywhere else here looked like wasted vertical space
                    right above the tabs. */}
                <div className="flex flex-col gap-1">
                  <TokenChart dexUrl={state.data.token.dexUrl} symbol={state.data.token.symbol} />

                  <div className="flex items-center justify-between">
                    <Tabs
                      tabs={scanTabs(state.data)}
                      active={tab}
                      onChange={(id) => {
                        if (id === "map") {
                          setMapOpen(true);
                          return;
                        }
                        setTab(id as ScanTab);
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setTransactionsExpanded(true)}
                      aria-label="Expand full transaction list"
                      title="Expand full transaction list"
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-ink-faint transition hover:bg-white/[0.06] hover:text-ink"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="animate-fade-up">
                  {tab === "whales" && <WhaleTable whales={state.data.whales} />}

                  {tab === "transactions" && (
                    <TransfersList transfers={state.data.transfers} tokenPriceUsd={state.data.token.priceUsd} />
                  )}

                  {tab === "summary" && (
                    <SummaryFooter aiSummary={state.data.aiSummary} dataSources={state.data.dataSources} />
                  )}
                </div>
              </div>

              {/* h-full instead of a guessed calc(100vh-Npx): the grid
                  above is now itself height-constrained (lg:min-h-0
                  lg:flex-1, resolving against AppShell's fixed-height
                  <main>), so with the default align-content: stretch this
                  single grid row already fills exactly the available
                  space — h-full on this column just claims that same
                  height precisely, no pixel-offset arithmetic involved.
                  min-h-0 is still required: a grid item's default
                  min-height is auto (sized to its content), which silently
                  overrides overflow-y-auto and lets it grow past its box
                  anyway — that's what let the last card or two spill out
                  and force the whole page to scroll instead of just this
                  column. No sticky needed either: nothing above this
                  column can scroll anymore, so there's nothing for it to
                  stay put against. */}
              <div className="flex min-h-0 flex-col gap-5 lg:h-full lg:overflow-y-auto lg:pr-1">
                <TokenHeader token={state.data.token} />
                <TokenStatsCard token={state.data.token} poolLabel={state.data.liquidity.pool} />
                <ScoreCard score={state.data.hoodScore} />
                <HealthGrid metrics={state.data.health} dense />
                <HolderDistribution buckets={state.data.holderDistribution} />
                <ClusterCards groups={state.data.groups} />
              </div>
            </div>

            <Modal open={mapOpen} onClose={() => setMapOpen(false)} title="HoodMap">
              <HoodMapView
                nodes={state.data.graph.nodes}
                groups={state.data.groups}
                allTransfers={state.data.allTransfers}
                tokenPriceUsd={state.data.token.priceUsd}
                tokenSymbol={state.data.token.symbol}
              />
            </Modal>

            <Modal
              open={transactionsExpanded}
              onClose={() => setTransactionsExpanded(false)}
              title="Transactions"
            >
              <TransfersList
                transfers={state.data.transfers}
                tokenPriceUsd={state.data.token.priceUsd}
                expanded
              />
            </Modal>
          </div>
        )}
      </div>

      {/* Only rendered pre-scan now — this section's own margin + toggle
          button used to add guaranteed extra height below the results grid
          on every scan, which was what forced the whole page (not just the
          sidebar) to scroll. It's a discovery aid for "haven't scanned
          anything yet"; once there's a result, it's not needed and its
          height was the one thing standing between "only the sidebar
          scrolls" and reality. */}
      {!hasResult && (
        <div className="mx-auto mt-10 max-w-[1800px]">
          <button
            type="button"
            onClick={() => setTopTokensOpen((v) => !v)}
            aria-expanded={topTokensOpen}
            className="glass-panel flex w-full items-center justify-between rounded-[10px] px-4 py-3 text-left transition hover:border-line-strong"
          >
            <span className="flex items-center gap-2 text-sm font-medium text-ink">
              <TrendingUp className="h-4 w-4 text-lime-soft" />
              Top memecoins on Robinhood Chain
            </span>
            <ChevronDown
              className={`h-4 w-4 text-ink-faint transition-transform ${topTokensOpen ? "rotate-180" : ""}`}
            />
          </button>
          {topTokensOpen && (
            <div className="mt-3 animate-fade-up">
              <TopTokens showHeader={false} viewAllHref="/tokens" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
