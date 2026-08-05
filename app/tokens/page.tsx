import Link from "next/link";
import { ArrowLeft, TrendingUp } from "lucide-react";
import { TopTokens } from "@/components/scan/TopTokens";

export default function TokensPage() {
  return (
    <div className="w-full px-4 py-6 md:px-6">
      <div className="mx-auto max-w-[1400px]">
        <Link
          href="/scan"
          className="mb-4 inline-flex items-center gap-1.5 text-xs text-ink-faint transition hover:text-ink-muted"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Scan
        </Link>

        <div className="mb-5 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-lime to-moss shadow-[var(--shadow-glow-lime)]">
            <TrendingUp className="h-4 w-4 text-canvas" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink">
              Top memecoins on Robinhood Chain
            </h1>
            <p className="text-sm text-ink-faint">
              Up to 100 tokens ranked by unique wallets observed transacting on-chain.
            </p>
          </div>
        </div>

        <TopTokens limit={100} />
      </div>
    </div>
  );
}
