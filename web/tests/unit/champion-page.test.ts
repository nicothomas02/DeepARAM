import { describe, expect, it } from "vitest";
import { buildOrder, championPage, scoreRows } from "@/lib/champion-page";
import { itemTier } from "@/lib/items";
import { championAugmentStages, estimatesFeedOnly } from "@/lib/estimates";
import { SIMULATOR_IN_STATS } from "@/lib/sim-policy";
import { liveWithChange } from "@/lib/champions";

// Champion page builds: the core shows its boots where they're bought, then the 4th, 5th and 6th item options.
describe("champion page core build", () => {
  const p = championPage("Annie")!;

  it("puts real boots in every core build, after the core while the Simulator's buy step is off", () => {
    expect(p.core.length).toBeGreaterThan(0);
    for (const r of p.core) {
      expect(r.boots).toBeDefined();
      expect(itemTier(r.boots!)).toBe("boots");
      expect(p.itemInfo[r.boots!]?.name).toBeTruthy();
      const order = buildOrder(r);
      expect(order).toHaveLength(r.items.length + 1);
      expect(order.filter((i) => i !== r.boots)).toEqual(r.items);
      // The Simulator is a fun tool only for now (lib/sim-policy.ts), so no simulated buy step.
      if (!SIMULATOR_IN_STATS) {
        expect(r.bootsAt).toBeUndefined();
        expect(order.at(-1)).toBe(r.boots);
      }
    }
  });

  it("orders a row by its boots step, with the boots last when the step isn't known", () => {
    const r = { items: [1, 2, 3], winRate: 0.5, pickRate: 0.1, lift: 0 };
    expect(buildOrder(r)).toEqual([1, 2, 3]);
    expect(buildOrder({ ...r, boots: 9 })).toEqual([1, 2, 3, 9]);
    expect(buildOrder({ ...r, boots: 9, bootsAt: 2 })).toEqual([1, 2, 9, 3]);
    expect(buildOrder({ ...r, boots: 9, bootsAt: 3 })).toEqual([1, 2, 3, 9]);
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
    // Feed-only estimates have no per-pick odds, so there is nothing to spread.
    if (estimatesFeedOnly()) return expect(m.size).toBe(0);
    expect(m.size).toBe(p.augments.length);
    for (const s of m.values()) {
      expect(s).toHaveLength(4);
      expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
    }
    const perPick = [0, 1, 2, 3].map((i) => p.augments.reduce((t, a) => t + a.pickRate * m.get(a.id)![i], 0));
    for (const v of perPick) expect(Math.abs(v - perPick[0])).toBeLessThan(0.05);
  });
});

// Starters, core builds, later items and rated spell pairs all rank by DeepScore, so a rare high win rate
// doesn't outrank a common, slightly lower one.
describe("DeepScore ranking of build lists", () => {
  it("puts a common solid pick above a rare lucky one", () => {
    const ranked = scoreRows([
      { id: "rare", winRate: 0.7, pickRate: 0.002 },
      { id: "solid", winRate: 0.56, pickRate: 0.4 },
      { id: "weak", winRate: 0.48, pickRate: 0.3 },
    ]);
    expect(ranked.map((r) => r.id)).toEqual(["solid", "rare", "weak"]);
  });

  it("ranks every list on the champion page best DeepScore first", () => {
    const p = championPage("Annie")!;
    for (const list of [p.starting, p.core, ...p.late.map((s) => s.options)]) {
      const scores = list.map((r) => r.deepScore!);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
  });
});

describe("misleading-number guards", () => {
  it("counts only the covered games for rows rebuilt from the six-item builds", () => {
    // Yasuo's core and single items come from his most common full builds (data/cn/builds/157.json "derived").
    const p = championPage("Yasuo")!;
    const champGames = liveWithChange().live.find((c) => c.name === "Yasuo")!.sample!;
    if (!p.coreDerived) return;
    for (const r of p.core) expect(r.games!).toBeLessThan(champGames * r.pickRate * 0.5);
  });

  it("compares starters with each other, not with the champion's own win rate", () => {
    for (const alias of ["Yasuo", "Ahri", "Jinx"]) {
      const s = championPage(alias)!.starting;
      if (s.length < 2) continue;
      // Measured against the listed starters' average, so they can't all sit above it.
      expect(s.some((r) => r.lift <= 0)).toBe(true);
    }
  });
});

describe("champion augment DeepScore from the live stats", () => {
  it("follows the grade, then pick rate, with the grade's tier letter", async () => {
    const { championAugmentScores } = await import("@/lib/champion-augment-scores");
    const s = championAugmentScores("x", [
      { id: 1, pickRate: 0.01, grade: "S" },
      { id: 2, pickRate: 0.3, grade: "A" },
      { id: 3, pickRate: 0.2, grade: "S" },
      { id: 4, pickRate: 0.5, grade: "C" },
    ]);
    expect(s.get(3)!).toBeGreaterThan(s.get(1)!);
    expect(s.get(1)!).toBeGreaterThanOrEqual(70);
    expect(s.get(2)!).toBeGreaterThanOrEqual(59);
    expect(s.get(2)!).toBeLessThan(70);
    expect(s.get(4)!).toBeLessThan(44);
  });
});
