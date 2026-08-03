import { connectorsForWallets, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http } from "wagmi";
import { arbitrum, base, mainnet, optimism } from "wagmi/chains";

const CHAINS = [mainnet, base, optimism, arbitrum] as const;

// A real WalletConnect Cloud project id (from https://cloud.walletconnect.com)
// enables the full wallet list, including WalletConnect's QR/mobile bridge.
// Without one, every WalletConnect-based wallet (which is most of RainbowKit's
// default set — Safe, Rainbow, Base Account, and even MetaMask's non-extension
// path all tunnel through it) eagerly calls Reown's remote config API on
// startup and fails with 403s, adding real startup cost for no benefit. So
// until a real id is set, fall back to just the browser-extension connector
// (MetaMask, Rabby, Coinbase extension, etc. via `window.ethereum`) — that's
// still a real, fully-working wallet connection, just without the WC bridge.
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

export const wagmiConfig = projectId
  ? getDefaultConfig({
      appName: "HoodMap",
      projectId,
      chains: CHAINS,
      ssr: true,
    })
  : createConfig({
      chains: CHAINS,
      transports: {
        [mainnet.id]: http(),
        [base.id]: http(),
        [optimism.id]: http(),
        [arbitrum.id]: http(),
      },
      connectors: connectorsForWallets(
        [{ groupName: "Browser", wallets: [injectedWallet] }],
        { appName: "HoodMap", projectId: "unused-without-walletconnect" },
      ),
      ssr: true,
    });
