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

// A single caller doing many sequential/concurrent calls (a paginated
// wallet fetch, a batch of swap-detection lookups) can exceed the free
// tier's 5 requests/second on its own, even with per-call pacing, since
// there's no shared limiter across every Blockscout call in the app.
// Confirmed live: a heavy wallet scan (~90 calls) immediately followed by
// an unrelated wallet's scan caused the SECOND scan to hit repeated 429s
// and timeouts. Retrying a fixed, short, conservative amount rather than
// giving up immediately (or trusting x-ratelimit-reset's exact semantics,
// which weren't fully confirmed — an observed value of "51475" doesn't
// read as plain seconds-until-reset) turns a transient rate-limit window
// into a brief delay instead of an immediate fall-through to the slower,
// less reliable live-RPC path.
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1_500;

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

export async function blockscoutGet<T>(
  path: string,
  // Accepts `null` alongside `undefined` — a page's own `next_page_params`
  // (BlockscoutPage above) comes back with `null` values for absent
  // fields, and this already treats both identically below (`v != null`
  // skips either), so the type should say so rather than forcing every
  // caller passing a page's own params back in to fight the type checker.
  params: Record<string, string | number | boolean | null | undefined> = {},
): Promise<T> {
  const key = apiKey();
  if (!key) throw new BlockscoutError("BLOCKSCOUT_API_KEY is not configured");

  const url = new URL(BASE_URL + path);
  url.searchParams.set("apikey", key);
  for (const [k, v] of Object.entries(params)) {
    if (v != null) url.searchParams.set(k, String(v));
  }

  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url.toString(), { signal: controller.signal });
    } catch (err) {
      // A timed-out request (AbortError, from the controller above) is
      // exactly as transient/retryable as a 429 — a hung connection isn't
      // evidence the wallet's data doesn't exist. Anything else (DNS
      // failure, TLS error, etc.) isn't worth retrying the same way.
      if (isAbortError(err) && attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (res.status === 429 && attempt < MAX_RETRIES) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      continue;
    }
    if (!res.ok) {
      // Body included where cheap (credit exhaustion / rate limit
      // responses are small JSON) — useful in logs without risking a huge
      // body on an unexpected large error page.
      const body = await res.text().catch(() => "");
      throw new BlockscoutError(`Blockscout API ${res.status} for ${path}: ${body.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }
}
