// Stub for @x402/* payment-scheme packages that @coinbase/cdp-sdk imports
// (dynamically, behind its own try/catch, or statically) but that aren't
// published on npm. This app never exercises the x402-payment code path, so
// this module is only ever loaded to satisfy Turbopack's build-time
// resolution — see next.config.ts. Exports the specific named bindings
// cdp-sdk's reachable modules import, so a static `import { x } from
// "@x402/evm"` doesn't fail with "no such export" even though nothing here
// actually calls these functions at runtime.
export function toClientEvmSigner() {
  throw new Error("x402 payments are not supported in this app.");
}
