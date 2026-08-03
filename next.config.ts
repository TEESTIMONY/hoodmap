import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  webpack: (config, { webpack }) => {
    // @coinbase/cdp-sdk (pulled in transitively by RainbowKit's default
    // Base Account connector) lazy-loads optional x402 payment-scheme
    // plugins under the @x402/* namespace that aren't published as
    // installable packages. They're only touched if an app actually uses
    // x402 payments, which this app doesn't, so ignore the whole namespace
    // instead of failing the build.
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^@x402\// }));
    return config;
  },
};

export default nextConfig;
