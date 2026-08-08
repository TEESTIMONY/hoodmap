// Candidate-holder selection — split out of analyze.server.ts so
// lib/indexer/snapshot.ts (the background balance-snapshot job) can pick the
// exact same candidate set from a token's FULL indexed history that the live
// scanner picks from its bounded transfer window, without duplicating this
// logic (and risking the two silently drifting apart, the same drift risk
// flagged elsewhere in this indexer).
import { ZERO_ADDRESS, type RawTransfer } from "./rpc.server";

export interface CandidateSelection {
  candidates: string[];
  activity: Map<string, number>;
  deployer?: string;
}

// Deployer heuristic: recipient of the earliest mint (from == 0x0) observed.
export function guessDeployer(transfers: RawTransfer[]): string | undefined {
  const mints = transfers
    .filter((t) => t.from.toLowerCase() === ZERO_ADDRESS)
    .sort((a, b) => Number(a.blockNumber - b.blockNumber));
  if (mints.length === 0) return undefined;
  return mints[0].to.toLowerCase();
}

// Picks the top `limit` most-active addresses (by transfer count, either
// direction) as balance-resolution candidates, always including the guessed
// deployer even if it falls outside that top slice — matches
// analyze.server.ts's original step 3 exactly.
export function selectCandidateHolders(transfers: RawTransfer[], limit: number): CandidateSelection {
  const activity = new Map<string, number>();
  for (const t of transfers) {
    const from = t.from.toLowerCase();
    const to = t.to.toLowerCase();
    if (from !== ZERO_ADDRESS) activity.set(from, (activity.get(from) ?? 0) + 1);
    if (to !== ZERO_ADDRESS) activity.set(to, (activity.get(to) ?? 0) + 1);
  }
  const candidates = Array.from(activity.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([addr]) => addr);

  const deployer = guessDeployer(transfers);
  if (deployer && !candidates.includes(deployer)) candidates.push(deployer);

  return { candidates, activity, deployer };
}
