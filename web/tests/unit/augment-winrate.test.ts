// Fair augment win rates (lib/augment-winrate.ts): popularity's pull is taken out within each rarity,
// each rarity averages 50%, and win ranks follow the fair rates.
import { describe, expect, it } from "vitest";
import { augmentRows, fairAugments } from "@/lib/augment-winrate";

describe("fair augment win rates", () => {
  it("removes a win rate that only follows pick rate", () => {
    const rows = [0.1, 0.2, 0.3, 0.4].map((p, i) => ({ augment_id: i, tier: "Gold", pick_rate: p, win_rate: 0.5 + p / 5 }));
    for (const r of fairAugments(rows)) expect(r.win_rate).toBeCloseTo(0.5, 4);
  });

  it("keeps each rarity centred on 50% and ranks by the fair rate", () => {
    const rows = augmentRows();
    for (const tier of ["Silver", "Gold", "Prismatic"]) {
      const g = rows.filter((r) => r.tier === tier);
      expect(g.length).toBeGreaterThan(10);
      expect(g.reduce((s, r) => s + r.win_rate, 0) / g.length).toBeCloseTo(0.5, 2);
    }
    const byRank = [...rows].sort((a, b) => a.win_rank! - b.win_rank!);
    for (let i = 1; i < byRank.length; i++) expect(byRank[i - 1].win_rate).toBeGreaterThanOrEqual(byRank[i].win_rate);
    expect(rows.every((r) => !("win_rank_change" in r))).toBe(true);
  });
});
