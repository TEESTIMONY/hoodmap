import type { NextConfig } from "next";

// @coinbase/cdp-sdk (pulled in transitively by RainbowKit's default Base
// Account connector) imports optional x402 payment-scheme packages under the
// @x402/* namespace that aren't published as installable packages — mostly
// behind its own try/catch-guarded dynamic import(), but @x402/evm is a
// plain static import in one file. This app never touches x402 payments, so
// a missing module is harmless at runtime — but Turbopack (like webpack)
// still needs every reachable specifier to resolve to *something* to build
// its module graph. Under webpack this was handled with `IgnorePlugin`;
// Turbopack has no exact equivalent (`turbopack.ignoreIssue` only silences
// the CLI/overlay message, it doesn't stub the module, so the build still
// fails), so instead each specifier is aliased to a real, empty local
// module. Must be a forward-slash relative path — Turbopack on Windows
// doesn't resolve absolute `C:\...` alias targets ("windows imports are not
// implemented yet").
const x402Stub = "./shims/x402-empty.js";

const nextConfig: NextConfig = {
  // Lets the dev server be reached from the LAN IP (e.g. testing from
  // another device) instead of only localhost.
  allowedDevOrigins: ["192.168.0.206"],
  // Turbopack's persistent filesystem cache (default on since Next.js
  // 16.1) writes/compacts a cache under .next/cache on every request. On
  // this machine that write was taking 30+ seconds per request (likely AV
  // real-time scanning touching every cache file — the same pattern that
  // corrupted the native SWC binary earlier), causing dev-server responses
  // to get progressively slower rather than faster. Disabled until that's
  // resolved at the OS level; without it, warm requests stay sub-second.
  experimental: {
    turbopackFileSystemCacheForDev: false,
  },
  turbopack: {
    resolveAlias: {
      "@x402/core/client": x402Stub,
      "@x402/evm/exact/client": x402Stub,
      "@x402/evm/upto/client": x402Stub,
      "@x402/svm/exact/client": x402Stub,
      "@x402/evm": x402Stub,
    },
  },
};

export default nextConfig;
