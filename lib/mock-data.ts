// Mock data layer. Nothing here is fetched from a backend yet — this is the
// shape a real API / subgraph indexer would eventually fill in, kept in one
// place so it's obvious what to swap out later.

export type Tier = "new" | "member" | "core" | "legendary";

export interface Person {
  id: string;
  handle: string;
  name: string;
  address: `0x${string}`;
  bio: string;
  tier: Tier;
  reputation: number;
  followers: number;
  following: number;
  signalsReceived: number;
  signalsGiven: number;
  badges: string[];
  colorSeed: string;
}

export interface Post {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
  replies: number;
  echoes: number;
  signals: number;
  tipped?: number;
  gated?: boolean;
  channel?: string;
}

export interface ConnectionEdge {
  from: string;
  to: string;
  strength: number;
}

export const TIER_LABEL: Record<Tier, string> = {
  new: "New signal",
  member: "Member",
  core: "Core",
  legendary: "Legendary",
};

export const people: Person[] = [
  {
    id: "me",
    handle: "nova.eth",
    name: "Nova",
    address: "0x9F1a2b3C4d5E6f7A8b9C0d1E2f3A4b5C6d7E8f90",
    bio: "Building in the open. Signal > noise.",
    tier: "core",
    reputation: 812,
    followers: 2140,
    following: 318,
    signalsReceived: 946,
    signalsGiven: 1201,
    badges: ["Genesis Member", "Constellation Explorer", "Early Signal", "Builder"],
    colorSeed: "nova",
  },
  {
    id: "vitalik",
    handle: "vitalik.eth",
    name: "Vitalik",
    address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
    bio: "Researching things. Occasionally posting about rollups.",
    tier: "legendary",
    reputation: 9911,
    followers: 482000,
    following: 214,
    signalsReceived: 51230,
    signalsGiven: 890,
    badges: ["Genesis Member", "Protocol Architect", "Legendary Signal"],
    colorSeed: "vitalik",
  },
  {
    id: "asha",
    handle: "asha.base.eth",
    name: "Asha Kapoor",
    address: "0x3aB1C2d3E4f5061728394A5b6C7d8E9f0A1b2C3d",
    bio: "Community lead. Onboarding the next million wallets.",
    tier: "core",
    reputation: 1440,
    followers: 8210,
    following: 512,
    signalsReceived: 3021,
    signalsGiven: 2884,
    badges: ["Community Builder", "Constellation Explorer"],
    colorSeed: "asha",
  },
  {
    id: "leo",
    handle: "leo.op",
    name: "Leo Marchetti",
    address: "0x77aA1234bB5678cC9012dD3456eE7890fF12345a",
    bio: "Smart contract security. If it's not audited, I haven't slept.",
    tier: "member",
    reputation: 640,
    followers: 1290,
    following: 402,
    signalsReceived: 720,
    signalsGiven: 655,
    badges: ["Bug Hunter"],
    colorSeed: "leo",
  },
  {
    id: "mira",
    handle: "mira.eth",
    name: "Mira Chen",
    address: "0x556677889900aAbBcCdDeEfF00112233445566aa",
    bio: "Design systems for onchain products.",
    tier: "core",
    reputation: 1102,
    followers: 4310,
    following: 288,
    signalsReceived: 2210,
    signalsGiven: 1900,
    badges: ["Design Guild", "Early Signal"],
    colorSeed: "mira",
  },
  {
    id: "dex",
    handle: "dex.arb",
    name: "Dexter Owusu",
    address: "0x11aa22bb33cc44dd55ee66ff778899aabbccdd11",
    bio: "Liquidity, MEV, and other things that keep me up at night.",
    tier: "member",
    reputation: 505,
    followers: 980,
    following: 640,
    signalsReceived: 410,
    signalsGiven: 812,
    badges: ["Builder"],
    colorSeed: "dex",
  },
  {
    id: "priya",
    handle: "priya.eth",
    name: "Priya Nair",
    address: "0x99887766554433221100ffeeddccbbaa9988776",
    bio: "DAO governance nerd. Ask me about quadratic voting.",
    tier: "member",
    reputation: 388,
    followers: 640,
    following: 210,
    signalsReceived: 302,
    signalsGiven: 275,
    badges: ["Governance"],
    colorSeed: "priya",
  },
  {
    id: "sam",
    handle: "sam.base",
    name: "Sam Okafor",
    address: "0x2233445566778899aabbccddeeff001122334455",
    bio: "New here. Onboarded via a friend's constellation ping.",
    tier: "new",
    reputation: 42,
    followers: 18,
    following: 64,
    signalsReceived: 6,
    signalsGiven: 11,
    badges: [],
    colorSeed: "sam",
  },
  {
    id: "kenji",
    handle: "kenji.eth",
    name: "Kenji Watanabe",
    address: "0xaabbccddeeff00112233445566778899aabbcc0",
    bio: "NFT tooling. Formerly game dev.",
    tier: "member",
    reputation: 574,
    followers: 1510,
    following: 340,
    signalsReceived: 690,
    signalsGiven: 560,
    badges: ["Builder"],
    colorSeed: "kenji",
  },
  {
    id: "zara",
    handle: "zara.op",
    name: "Zara Ali",
    address: "0xffeeddccbbaa00112233445566778899aabbccd",
    bio: "Public goods funding. Retro-active everything.",
    tier: "core",
    reputation: 1330,
    followers: 3980,
    following: 190,
    signalsReceived: 2650,
    signalsGiven: 2100,
    badges: ["Public Goods", "Constellation Explorer"],
    colorSeed: "zara",
  },
  {
    id: "tom",
    handle: "tom.arb",
    name: "Tom Baptiste",
    address: "0x00112233445566778899aabbccddeeff0011223",
    bio: "Trader by day, node operator by night.",
    tier: "new",
    reputation: 96,
    followers: 88,
    following: 120,
    signalsReceived: 30,
    signalsGiven: 44,
    badges: [],
    colorSeed: "tom",
  },
];

export const peopleById = new Map(people.map((p) => [p.id, p]));

export function findPerson(handleOrId: string): Person | undefined {
  return people.find((p) => p.id === handleOrId || p.handle === handleOrId);
}

export const posts: Post[] = [
  {
    id: "p1",
    authorId: "vitalik",
    body: "Rollup fees keep trending down. The endgame was never about a single chain winning — it's about the whole stack getting boring and cheap.",
    createdAt: minutesAgo(6),
    replies: 412,
    echoes: 1290,
    signals: 8820,
    channel: "research",
  },
  {
    id: "p2",
    authorId: "asha",
    body: "Ran a 40-person onboarding session today entirely through Constellation invites. Nobody touched a seed phrase before they understood what they were signing. That's the bar.",
    createdAt: minutesAgo(22),
    replies: 34,
    echoes: 61,
    signals: 402,
    channel: "community",
  },
  {
    id: "p3",
    authorId: "mira",
    body: "Shipping a token-gated theme pack this week — your aura ring actually changes based on reputation tier now, not just a static badge. Screens below.",
    createdAt: minutesAgo(48),
    replies: 58,
    echoes: 120,
    signals: 980,
    gated: true,
    channel: "design",
  },
  {
    id: "p4",
    authorId: "leo",
    body: "PSA: audited a contract this week that had a beautifully obfuscated reentrancy bug hiding behind a proxy upgrade. Always read the implementation, not just the proxy ABI.",
    createdAt: hoursAgo(2),
    replies: 96,
    echoes: 340,
    signals: 2210,
    channel: "security",
  },
  {
    id: "p5",
    authorId: "priya",
    body: "Quadratic voting result is in: the proposal passed with broader participation than any vote we've run. Turnout > total voting power, for once.",
    createdAt: hoursAgo(4),
    replies: 71,
    echoes: 145,
    signals: 890,
    channel: "governance",
  },
  {
    id: "p6",
    authorId: "dex",
    body: "Watched an MEV bot get front-run by a smarter MEV bot today. There's a strange beauty in the chaos.",
    createdAt: hoursAgo(6),
    replies: 22,
    echoes: 58,
    signals: 340,
    channel: "markets",
  },
  {
    id: "p7",
    authorId: "sam",
    body: "First post here — got pinged into this place by a friend's Constellation node lighting up on my feed. Still figuring out how signals work but I like it.",
    createdAt: hoursAgo(9),
    replies: 41,
    echoes: 12,
    signals: 88,
    channel: "community",
  },
  {
    id: "p8",
    authorId: "zara",
    body: "Retro round 12 payouts are live. 340 builders funded, median grant up 18% from last round. Public goods funding compounds when you keep showing the receipts.",
    createdAt: hoursAgo(12),
    replies: 63,
    echoes: 210,
    signals: 1540,
    channel: "public-goods",
  },
  {
    id: "p9",
    authorId: "me",
    body: "Two weeks into building HoodMap in the open. Today's favorite bug: the aurora ring animation looked perfect until we tested it in light mode. Dark mode stays primary for a reason.",
    createdAt: hoursAgo(15),
    replies: 29,
    echoes: 84,
    signals: 610,
    channel: "build-log",
  },
  {
    id: "p10",
    authorId: "kenji",
    body: "Tooling update: you can now preview an NFT's traits before mint completes, straight from calldata simulation. No more surprise JPEGs.",
    createdAt: hoursAgo(20),
    replies: 18,
    echoes: 46,
    signals: 275,
    channel: "build-log",
  },
];

export const channels = [
  { id: "research", name: "Research", members: 18400 },
  { id: "community", name: "Community", members: 42100 },
  { id: "design", name: "Design", members: 6300 },
  { id: "security", name: "Security", members: 11800 },
  { id: "governance", name: "Governance", members: 5200 },
  { id: "public-goods", name: "Public Goods", members: 7400 },
  { id: "build-log", name: "Build Log", members: 9800 },
];

// Connections for the Constellation graph. `me` is intentionally the most
// connected node so the default view reads as "your" social graph.
export const edges: ConnectionEdge[] = [
  { from: "me", to: "vitalik", strength: 0.4 },
  { from: "me", to: "asha", strength: 0.95 },
  { from: "me", to: "mira", strength: 0.85 },
  { from: "me", to: "leo", strength: 0.6 },
  { from: "me", to: "dex", strength: 0.5 },
  { from: "me", to: "priya", strength: 0.55 },
  { from: "me", to: "zara", strength: 0.7 },
  { from: "me", to: "kenji", strength: 0.65 },
  { from: "me", to: "sam", strength: 0.9 },
  { from: "asha", to: "zara", strength: 0.6 },
  { from: "asha", to: "sam", strength: 0.4 },
  { from: "mira", to: "kenji", strength: 0.45 },
  { from: "leo", to: "dex", strength: 0.5 },
  { from: "priya", to: "zara", strength: 0.4 },
  { from: "vitalik", to: "zara", strength: 0.3 },
  { from: "kenji", to: "tom", strength: 0.35 },
  { from: "dex", to: "tom", strength: 0.5 },
  { from: "leo", to: "vitalik", strength: 0.25 },
];

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
}

function hoursAgo(n: number): string {
  return new Date(Date.now() - n * 3_600_000).toISOString();
}
