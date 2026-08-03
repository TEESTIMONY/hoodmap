"use client";

import { GlassPanel } from "@/components/ui/GlassPanel";

function toEmbedUrl(dexUrl: string): string | null {
  try {
    const url = new URL(dexUrl);
    url.searchParams.set("embed", "1");
    url.searchParams.set("theme", "dark");
    url.searchParams.set("trades", "0");
    url.searchParams.set("info", "0");
    return url.toString();
  } catch {
    return null;
  }
}

export function TokenChart({ dexUrl, symbol }: { dexUrl?: string; symbol: string }) {
  const embedUrl = dexUrl ? toEmbedUrl(dexUrl) : null;

  if (!embedUrl) {
    return (
      <GlassPanel className="flex h-[220px] items-center justify-center p-4 text-center text-sm text-ink-faint">
        No DexScreener pair found for {symbol} — chart unavailable.
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="overflow-hidden p-0">
      <iframe
        key={embedUrl}
        src={embedUrl}
        title={`${symbol} price chart`}
        className="h-[440px] w-full border-0"
        loading="lazy"
      />
    </GlassPanel>
  );
}
