// Thin client for Robinhood Chain's Blockscout Pro API — the officially
// operated block explorer for this chain, indexing full history from
// genesis. Used as a PRIMARY data source for surfaces that used to be pure
// live-RPC scans (discovery today; wallet passport / token holders next),
// always with a fallback to the existing live-RPC path on any failure —
// same "a third-party data source must never be the reason a scan fails"
// discipline as every DB-backed hybrid module in lib/indexer/.
//
// Credit-based free tier (confirmed live): 100,000 credits/day, 5 requests
// per second, most endpoints cost 20 credits/call. BLOCKSCOUT_API_KEY
// (from dev.blockscout.com) must be set — every caller here treats a
// missing key or any request failure as "not available right now" rather
// than a hard error, so this can be deployed before the key exists in a
// given environment (e.g. before it's added to Vercel) without breaking
// anything, just falling back to the pre-Blockscout behavior.
const CHAIN_ID = 4663;
const BASE_URL = `https://api.blockscout.com/${CHAIN_ID}/api/v2`;
// A hung request must not hold up a scan indefinitely — same reasoning as
// rpc.server.ts's own RPC timeout.
const REQUEST_TIMEOUT_MS = 10_000;

export class BlockscoutError extends Error {}

function apiKey(): string | undefined {
  return process.env.BLOCKSCOUT_API_KEY;
}

export function blockscoutConfigured(): boolean {
  return Boolean(apiKey());
}

export interface BlockscoutPage<T> {
  items: T[];
  next_page_params: Record<string, string | number | boolean | null> | null;
}

export async function blockscoutGet<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<T> {
  const key = apiKey();
  if (!key) throw new BlockscoutError("BLOCKSCOUT_API_KEY is not configured");

  const url = new URL(BASE_URL + path);
  url.searchParams.set("apikey", key);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      // Body included where cheap (credit exhaustion / rate limit responses
      // are small JSON) — useful in logs without risking a huge body on an
      // unexpected large error page.
      const body = await res.text().catch(() => "");
      throw new BlockscoutError(`Blockscout API ${res.status} for ${path}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}
