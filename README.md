# HoodMap — a Web3-native community platform

A from-scratch redesign of a Twitter/Telegram-style community product for
onchain communities: a feed, profiles, and a living map of your social graph,
with a new design system built for trust, clarity, and a bit of delight.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000. Wallet connect works out of the box against a
placeholder WalletConnect project id; for real usage create a project at
https://cloud.walletconnect.com and set:

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your-project-id
```

Dev and build run on webpack (`next dev --webpack` / `next build --webpack`)
rather than Turbopack — see the comment in `next.config.ts`: RainbowKit's
default connector set transitively pulls in Coinbase's `@coinbase/cdp-sdk`,
which lazy-loads optional `x402` payment-scheme packages that aren't
published as installable dependencies. Turbopack doesn't yet expose an
equivalent to webpack's `IgnorePlugin`, so the config falls back to webpack
to stub that namespace out.

## Design decisions — the "why"

**Why not reuse a typical dark-dashboard look.** The brief specifically asked
for something that doesn't read like the reference screenshots (a network
graph tool, a CRM workspace, a finance dashboard) even though it should
borrow their *materials* — dark canvas, glass panels, restrained neon accent.
A social feed has different needs than an admin panel: it's read constantly,
by many people, for long sessions, and needs to feel calm rather than
data-dense. So HoodMap keeps the dark glass aesthetic but drops the
grid-of-cards admin layout in favor of a single reading column (feed,
profile) and a full-bleed canvas only where it earns its keep
(Constellation).

**Why an "aurora" duotone instead of a single neon accent.** A lone accent
color (lime, moss, whatever) reads as "developer tool." Pairing lime and
moss into gradients — buttons, aura rings, edges in the graph — gives the
product a signature without leaning on any single web3-cliché color, and
gives us a natural way to encode *reputation* (tier colors) without
inventing a second, unrelated palette.

**Why reputation is a visual ring, not just a number.** Trust is the core
promise of the product ("high-trust, high-end interface"). Rather than
bury reputation in a profile stat, every avatar everywhere — feed, profile,
graph — wears it as a ring: gray for new accounts, lime for members, a
lime→moss gradient for core members, and a slowly rotating conic-gradient
aura for the legendary tier. It's glanceable and it's the same visual
language in every surface, which is what makes a design system feel
considered rather than assembled.

**Why the fun feature is the social graph, not a minigame.** The brief asked
for something that creates delight and is native to the product, not bolted
on. A generic minigame (spin-to-win, a badge collector) would be exactly
that: bolted on. Instead, **Constellation** takes the thing a Web3 community
product already has — a social graph — and turns it into a living, explorable
map: your connections float gently, ambient signals travel across edges in
the background so the network never looks dead, and clicking someone and
sending them a Signal launches a small particle traveling across the graph
in real time, flashes their node, and lands on the live ticker and
leaderboard. It's the kind of interaction people screenshot or clip, and it
reinforces the reputation system rather than existing beside it.

**Why real wallet connect now, not stubbed.** Identity is load-bearing for a
Web3 community product — copy-address, ENS-style handles, and the reputation
system all assume a wallet is the source of truth. Wiring RainbowKit + wagmi
for real (rather than a fake "Connect Wallet" button) means the identity
model in the UI is already correct, even though sign-in gating and profile
ownership aren't implemented yet.

## What's built

- **Design system** — `app/globals.css`: color tokens, radii, the rotating
  aura-ring effect, drifting aurora background blobs, motion tokens.
- **App shell** — `components/layout/AppShell.tsx`: nav rail, top bar,
  search, wallet connect. `components/layout/ComingSoon.tsx` for the
  not-yet-built nav destinations (Channels, Messages, Notifications) so
  the nav is honest about what's real today.
- **Feed** — `app/page.tsx` + `components/feed/*`: composer, post cards with
  reply/echo/signal/tip actions, and a live "Network pulse" side rail
  (activity sparkline, trending channels, who-to-follow).
- **Profile** — `app/profile/[handle]/page.tsx` + `components/profile/*`:
  identity header with copyable address, reputation stats, badge shelf, and
  Posts / Replies / Constellation tabs.
- **Constellation** — `app/constellation/page.tsx` +
  `components/constellation/*`: the interactive social-graph map described
  above, plus a smaller static preview embedded in profiles.
- **Wallet** — `lib/wagmi.ts`, `app/providers.tsx`,
  `components/wallet/ConnectWallet.tsx`: wagmi + RainbowKit wired for real,
  themed to match the design system via `ConnectButton.Custom`.

Data is mocked in `lib/mock-data.ts` — it's written as the shape a real
indexer/API would fill in later (one place to swap out, not scattered
inline arrays).

## What's next

- Real backend: posts, follows, and signals are currently client-only state.
- Channels, Messages, and Notifications (stubbed in nav today).
- Force-directed layout (or a real graph engine) once the network is large
  enough that the deterministic golden-angle layout stops reading as
  intentional and starts reading as crowded.
- Onchain reputation/token-gating enforcement (the UI models it; nothing is
  actually gated yet).
