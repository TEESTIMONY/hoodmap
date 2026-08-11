// Plain, isomorphic address-format validation — deliberately NOT in
// actions.ts (a "use server" module, where every export becomes a Server
// Action reference, not a callable pure function a client component could
// import directly) so both the client pages and the server actions can
// share the exact same check.
//
// Why this needs to run client-side, not just server-side: Next.js
// redacts a thrown Error's message in production for anything that
// reaches the server (see node_modules/next/dist/docs/.../error.md — "this
// behavior is different in production to avoid leaking potentially
// sensitive details"). A malformed address is an expected, everyday input
// mistake, not a real server error — throwing for it server-side meant a
// real user typing a slightly-wrong address saw an opaque
// "POST /wallet 500" with no visible explanation in production, even
// though the server logged the friendly message correctly (confirmed
// live). Checking the format before ever calling the server action avoids
// the round trip AND the redaction entirely for the common case; the
// server-side check in actions.ts stays in place as defense-in-depth for
// any caller that bypasses the client UI.
export const INVALID_CONTRACT_ADDRESS_MESSAGE =
  "That doesn't look like a valid Robinhood Chain contract address.";
export const INVALID_WALLET_ADDRESS_MESSAGE =
  "That doesn't look like a valid Robinhood Chain wallet address.";

export function isPlausibleAddress(a: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(a.trim());
}
