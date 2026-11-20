import "server-only";
import championIds from "@/data/champion-ids.json";
import { readRepoJson } from "./repo-data";
import type { SynergyPair } from "./synergy-picks";

// Augment pairs that feed each other on one champion (data/estimates/augment_synergy.py, estimated): the Simulator's
// gain of the pair over the two alone, in win-rate points, plus confirmed mechanics (augment_synergy_rules.json).
// The champion page's augment table re-ranks with them once a visitor marks the augments they took
// (lib/synergy-picks.ts). The Simulator still has known gaps, so a pair only it found counts at SIM_WEIGHT; confirmed
// mechanics (rules) count in full.

const SIM_WEIGHT = 0.5;

type Data = {
  champions: Record<string, { a: number; b: number; points?: number; a_first?: number; b_first?: number; source: "sim" | "rule" | "order"; why?: string }[]>;
};

/** The champion's synergy pairs whose augments are both in `ids` (the augments its players take). */
export function augmentSynergy(alias: string, ids: Iterable<number>): SynergyPair[] {
  const key = (championIds as Record<string, number>)[alias];
  const rows = readRepoJson<Data>("data/estimates/augment_synergy.json")?.champions[String(key)] ?? [];
  const have = new Set(ids);
  return rows
    .filter((r) => have.has(r.a) && have.has(r.b))
    .map((r) => ({
      a: r.a,
      b: r.b,
      points: Math.round((r.points ?? 0) * (r.source === "sim" && !r.why ? SIM_WEIGHT : 1) * 100) / 100,
      rule: r.source !== "sim" || !!r.why,
      ...(r.source === "order" ? { order: [r.a_first ?? 0, r.b_first ?? 0] as [number, number] } : {}),
      ...(r.why ? { why: r.why } : {}),
    }));
}
