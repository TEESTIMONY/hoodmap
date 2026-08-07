# Indexer

A persistent store for Robinhood Chain transfer history, separate from the
Next.js app. The app's scan endpoints still read live from RPC today —
nothing in `app/` or the existing `lib/scan/*` code depends on this yet.
This exists so that migration can happen incrementally, one endpoint at a
time, instead of as one big rewrite.

## Why this exists

Every scan in this app currently re-derives everything live from RPC,
bounded to a recent window, because there's nowhere to store what's
already been read. That's the root cause of most of the reliability/speed
trade-offs made elsewhere in this codebase (`SCAN_BLOCKS`,
`MAX_TRANSFER_LOGS`, the wallet scanner's tiered lookback, etc.) — none of
that is a code quality problem, it's the ceiling of "compute everything
fresh, inside one request, against an RPC node we don't control."

This indexer separates **ingest** (a background worker that continuously
pulls from RPC into Postgres — can be slow, can retry forever, nobody's
waiting on it) from **serving** (the app queries Postgres — fast, complete,
independent of RPC health at read time).

## What's already verified

`lib/indexer/__tests__/worker.test.ts` runs the real sync logic against a
real Postgres engine (PGlite — Postgres compiled to WASM, in-process, no
external service needed) **and** real Robinhood Chain RPC calls. Confirmed
live: schema round-trips a full uint256-range value with no precision
loss, a real 50-block chunk ingests correctly (600-1,300+ transfers per
chunk at current chain activity — this chain is very active), and
re-running the same range twice does not duplicate rows. Run it yourself:

```bash
npm test -- lib/indexer/__tests__/worker.test.ts
```

## What you need to do to actually run this in production

I can't provision third-party accounts on your behalf — these three steps
need you:

1. **Create a Postgres instance.** Neon or Supabase both have free tiers
   and work fine from both Vercel and an external worker process. Grab the
   connection string.
2. **Set `DATABASE_URL`** (locally in `.env.local`, and in whatever hosts
   the worker in step 3) to that connection string.
3. **Create tables + run the worker somewhere that isn't Vercel.** Vercel
   functions can't run a continuous background process — this needs a
   small always-on host: Railway, Fly.io, Render (as a "worker"/background
   service, not a web service), or even a cheap VPS.

Once `DATABASE_URL` is set:

```bash
npm run db:generate   # writes SQL migration files from schema.ts
npm run db:migrate    # creates the tables
npm run indexer:start # starts the continuous sync loop (run this on the worker host, not locally long-term)
```

`INDEXER_START_BLOCK` (env var, optional, defaults to `0`) controls how far
back backfill starts. Starting from `0` gets full chain history
eventually, but this chain is at ~30M blocks with real activity —
backfilling from genesis will take a long time. Consider starting from a
more recent block (e.g. whenever the tokens you actually care about were
deployed) to reach "live and useful" fast, then backfilling further back
as a lower-priority concern. The worker is safe to stop and restart at any
point — progress is durable in the `sync_state` table.

## What's next (not built yet)

Once there's real data flowing, migrate scan endpoints to read from
Postgres instead of live RPC — highest-value first:

1. Token holder/cluster analysis (`analyze.server.ts`) — the piece behind
   most of this session's "why can't we see this wallet" conversations.
   Becomes a DB query with no recency-window limit instead of a bounded
   live scan.
2. Discovery/trending (`discover.server.ts`) — becomes a DB query instead
   of a live 800-block scan, and can safely look back much further.
3. Wallet PnL scanning (`wallet-analyze.server.ts`) — same shape of win.

`balanceOf` reads can likely stay live via RPC even after this migration —
they're cheap, single-address calls, not the bottleneck; it's the *scan
across many transfers* that's expensive and worth moving to the DB first.
