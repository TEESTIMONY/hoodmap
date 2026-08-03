"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { shortAddress } from "@/lib/utils";

export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable — nothing meaningful to recover into.
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/[0.03] px-2.5 py-1 font-mono text-xs text-ink-muted transition hover:border-line-strong hover:text-ink"
    >
      {shortAddress(address)}
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}
