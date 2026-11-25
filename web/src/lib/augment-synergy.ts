import "server-only";
import championIds from "@/data/champion-ids.json";
import { readRepoJson } from "./repo-data";
import type { SynergyPair } from "./synergy-picks";

// Augment pairs that feed each other on one champion (data/estimates/augment_synergy.py, estimated): the Simulator's
// gain of the pair over the two alone, in win-rate points, plus confirmed mechanics (augment_synergy_rules.json).
// The champion page's augment table re-ranks with them once a visitor marks the augments they took
// (lib/synergy-picks.ts). Only confirmed mechanics (augment_synergy_rules.json) count: the Simulator doesn't play
// like a real game yet, so pairs only it found are left out (Nico 2026-11-20: the Simulator is a fun tool for now).

type Data = {
  champions: Record<string, { a: number; b: number; points?: number; a_first?: number; b_first?: number; source: "sim" | "rule" | "order"; why?: string }[]>;
};

// Re-tested on Mayhem games as the archive grows (data/estimates/pair_check.py, Nico approved 2026-11-25): a pair
// whose holders do clearly worse than its two augments alone is pruned.
type PairCheck = { pairs: { ids?: number[]; verdict: string }[] };
let pruned: Set<string> | null = null;
const pairKey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

/** The champion's synergy pairs whose augments are both in `ids` (the augments its players take). */
export function augmentSynergy(alias: string, ids: Iterable<number>): SynergyPair[] {
  const key = (championIds as Record<string, number>)[alias];
  const rows = readRepoJson<Data>("data/estimates/augment_synergy.json")?.champions[String(key)] ?? [];
  pruned ??= new Set(
    (readRepoJson<PairCheck>("data/estimates/pair_check.json")?.pairs ?? []).filter((p) => p.verdict === "prune" && p.ids?.length === 2).map((p) => pairKey(p.ids![0], p.ids![1])),
  );
  const have = new Set(ids);
  return rows
    .filter((r) => have.has(r.a) && have.has(r.b) && (r.source !== "sim" || !!r.why) && !pruned!.has(pairKey(r.a, r.b)))
    .map((r) => ({
      a: r.a,
      b: r.b,
      points: r.points ?? 0,
      rule: r.source !== "sim" || !!r.why,
      ...(r.source === "order" ? { order: [r.a_first ?? 0, r.b_first ?? 0] as [number, number] } : {}),
      ...(r.why ? { why: r.why } : {}),
    }));
}
