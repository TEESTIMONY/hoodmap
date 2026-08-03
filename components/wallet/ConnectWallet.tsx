"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ChevronDown, Wallet } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function ConnectWallet() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openChainModal, openConnectModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;

        return (
          <div
            {...(!ready && {
              "aria-hidden": true,
              style: { opacity: 0, pointerEvents: "none", userSelect: "none" },
            })}
          >
            {!connected ? (
              <Button variant="primary" size="md" onClick={openConnectModal}>
                <Wallet className="h-4 w-4" />
                Connect wallet
              </Button>
            ) : chain?.unsupported ? (
              <Button variant="danger" size="md" onClick={openChainModal}>
                Wrong network
              </Button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={openChainModal}
                  className="hidden items-center gap-1.5 rounded-full border border-line bg-white/[0.04] px-3 py-2 text-xs text-ink-muted transition hover:border-line-strong sm:flex"
                >
                  {chain.hasIcon && chain.iconUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img alt={chain.name ?? "chain"} src={chain.iconUrl} className="h-3.5 w-3.5" />
                  )}
                  {chain.name}
                </button>
                <button
                  onClick={openAccountModal}
                  className="glass-panel flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-sm text-ink transition hover:border-line-strong"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-lime to-moss text-xs font-semibold text-canvas">
                    {account.displayName.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="font-mono text-xs">{account.displayName}</span>
                  <ChevronDown className="h-3.5 w-3.5 text-ink-faint" />
                </button>
              </div>
            )}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
