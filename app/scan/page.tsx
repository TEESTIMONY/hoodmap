"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ChevronDown, Search, ScanLine, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Tabs, type TabItem } from "@/components/ui/Tabs";
import { TokenHeader } from "@/components/scan/TokenHeader";
import { TokenChart } from "@/components/scan/TokenChart";
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
import type { AnalysisResult } from "@/lib/scan/types";

const STEPS: { key: ProgressStep; label: string }[] = [
  { key: "validating", label: "Validate contract" },
  { key: "onchain", label: "Read Robinhood Chain" },
  { key: "market", label: "Fetch market data" },
  { key: "rendering", label: "Compute intelligence" },
];

function scanTabs(data: AnalysisResult): TabItem[] {
  return [
    { id: "overview", label: "Overview" },
    { id: "chart", label: "Chart" },
    { id: "map", label: "HoodMap", count: data.graph.nodes.length },
    { id: "whales", label: "Whales", count: data.whales.length },
    { id: "transactions", label: "Transactions", count: data.transfers.length },
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

type ScanTab = "overview" | "chart" | "map" | "whales" | "transactions" | "summary";

export default function ScanPage() {
  const [address, setAddress] = useState("");
  const [progress, setProgress] = useState<ProgressStep | null>(null);
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ready"; data: AnalysisResult }
  >({ kind: "idle" });
  const [tab, setTab] = useState<ScanTab>("overview");
  // Open by default so first-time visitors still see trending tokens for
  // discovery; collapses the moment a scan is run, since the results
  // themselves are the focus at that point — reopen anytime via the toggle.
  const [topTokensOpen, setTopTokensOpen] = useState(true);
  const ranFromQuery = useRef(false);

  async function runAnalysis(raw: string) {
    if (!raw.trim()) return;
    setState({ kind: "loading" });
    setTab("overview");
    setTopTokensOpen(false);
    setProgress("validating");
    try {
      const data = await analyzeToken(raw, (u) => setProgress(u.step));
      setState({ kind: "ready", data });
      setProgress(null);
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "Scan failed." });
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

  return (
    <div className="w-full px-4 py-6 md:px-6">
      <Suspense fallback={null}>
        <AddressFromQuery onAddress={onAddressFromQuery} />
      </Suspense>

      <div className={`mx-auto ${hasResult ? "max-w-6xl" : "max-w-3xl pt-[6vh]"}`}>
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
          <div className="mt-6 flex flex-col items-center gap-4">
            <BubbleLoader />
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
          <div className="mt-6 flex flex-col gap-5">
            {/* Always visible — context you need before you've even picked a
                tab, not buried a click away. Everything else (chart, map,
                whale/transaction tables, summary) used to stack endlessly
                below this; it's now one section at a time via tabs. */}
            <TokenHeader token={state.data.token} />
            <WarningsBanner warnings={state.data.warnings} />
            <ScoreCard score={state.data.hoodScore} />

            <Tabs tabs={scanTabs(state.data)} active={tab} onChange={(id) => setTab(id as ScanTab)} />

            <div className="animate-fade-up">
              {tab === "overview" && (
                <div className="flex flex-col gap-5">
                  <HealthGrid metrics={state.data.health} />
                  <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                    <HolderDistribution buckets={state.data.holderDistribution} />
                    <ClusterCards groups={state.data.groups} />
                  </div>
                </div>
              )}

              {tab === "chart" && (
                <TokenChart dexUrl={state.data.token.dexUrl} symbol={state.data.token.symbol} />
              )}

              {tab === "map" && (
                <HoodMapView
                  nodes={state.data.graph.nodes}
                  groups={state.data.groups}
                  allTransfers={state.data.allTransfers}
                  tokenPriceUsd={state.data.token.priceUsd}
                  tokenSymbol={state.data.token.symbol}
                />
              )}

              {tab === "whales" && <WhaleTable whales={state.data.whales} />}

              {tab === "transactions" && <TransfersList transfers={state.data.transfers} />}

              {tab === "summary" && (
                <SummaryFooter aiSummary={state.data.aiSummary} dataSources={state.data.dataSources} />
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mx-auto mt-10 max-w-[1800px]">
        <button
          type="button"
          onClick={() => setTopTokensOpen((v) => !v)}
          aria-expanded={topTokensOpen}
          className="glass-panel flex w-full items-center justify-between rounded-lg px-4 py-3 text-left transition hover:border-line-strong"
        >
          <span className="flex items-center gap-2 text-sm font-medium text-ink">
            <TrendingUp className="h-4 w-4 text-lime-soft" />
            Top tokens on Robinhood Chain
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
    </div>
  );
}
