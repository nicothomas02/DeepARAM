import { describe, expect, it } from "vitest";
import { championPage } from "@/lib/champion-page";
import { itemTier } from "@/lib/items";
import { championAugmentStages } from "@/lib/estimates";

// Champion page builds: the core shows its boots, then the 4th, 5th and 6th item options.
describe("champion page core build", () => {
  const p = championPage("Annie")!;

  it("puts boots in front of every core build", () => {
    expect(p.core.length).toBeGreaterThan(0);
    for (const r of p.core) {
      expect(r.boots).toBeDefined();
      expect(itemTier(r.boots!)).toBe("boots");
      expect(p.itemInfo[r.boots!]?.name).toBeTruthy();
    }
  });

  it("offers legendary options for slots 4, 5 and 6 that skip the core and earlier top picks", () => {
    expect(p.late.map((s) => s.slot)).toEqual([4, 5, 6]);
    const taken = new Set(p.core[0].items);
    for (const s of p.late) {
      expect(s.options.length).toBeGreaterThan(0);
      for (const o of s.options) {
        expect(o.tier).toBe("legendary");
        expect(taken.has(o.items[0])).toBe(false);
      }
      const scores = s.options.map((o) => o.deepScore!);
      expect([...scores].sort((a, b) => b - a)).toEqual(scores);
      taken.add(s.options[0].items[0]);
    }
  });
});

describe("champion augment pick order estimate", () => {
  it("gives each augment shares that sum to 1 and spreads the champion's picks over all four picks", () => {
    const p = championPage("Annie")!;
    const m = championAugmentStages(p.augments);
    expect(m.size).toBe(p.augments.length);
    for (const s of m.values()) {
      expect(s).toHaveLength(4);
      expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
    }
    const perPick = [0, 1, 2, 3].map((i) => p.augments.reduce((t, a) => t + a.pickRate * m.get(a.id)![i], 0));
    for (const v of perPick) expect(Math.abs(v - perPick[0])).toBeLessThan(0.05);
  });
});
