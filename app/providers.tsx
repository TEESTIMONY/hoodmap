"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { darkTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { useState } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";

const aetherTheme = darkTheme({
  accentColor: "#D6FA4D",
  accentColorForeground: "#06070a",
  borderRadius: "large",
  fontStack: "system",
  overlayBlur: "small",
});

aetherTheme.colors.modalBackground = "#0d0f14";
aetherTheme.colors.modalBorder = "rgba(255,255,255,0.08)";
aetherTheme.colors.profileForeground = "#13161d";
aetherTheme.shadows.dialog = "0 24px 80px -20px rgba(0,0,0,0.6)";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={aetherTheme} modalSize="compact">
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
