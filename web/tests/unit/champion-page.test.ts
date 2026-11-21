import { describe, expect, it } from "vitest";
import { buildOrder, championPage, scoreRows } from "@/lib/champion-page";
import { itemSituation, itemTier } from "@/lib/items";
import { championAugmentStages } from "@/lib/estimates";
import { MIN_FOLLOWING } from "@/lib/card-score";

// Champion page builds: the core shows its boots where they're bought, then the 4th, 5th and 6th item options.
describe("champion page core build", () => {
  const p = championPage("Annie")!;

  it("puts real boots in every core build, where players buy them (game timelines, not the Simulator)", () => {
    expect(p.core.length).toBeGreaterThan(0);
    for (const r of p.core) {
      expect(r.boots).toBeDefined();
      expect(itemTier(r.boots!)).toBe("boots");
      expect(p.itemInfo[r.boots!]?.name).toBeTruthy();
      const order = buildOrder(r);
      expect(order).toHaveLength(r.items.length + 1);
      expect(order.filter((i) => i !== r.boots)).toEqual(r.items);
      // The step comes from players' purchase timelines (data/estimates/boots_slot.json); the Simulator is a fun
      // tool only for now (lib/sim-policy.ts), so it never sets one.
      expect(r.bootsAt).toBe(1);
      expect(order[1]).toBe(r.boots);
    }
  });

  it("orders a row by its boots step, with the boots last when the step isn't known", () => {
    const r = { items: [1, 2, 3], winRate: 0.5, pickRate: 0.1, lift: 0 };
    expect(buildOrder(r)).toEqual([1, 2, 3]);
    expect(buildOrder({ ...r, boots: 9 })).toEqual([1, 2, 3, 9]);
    expect(buildOrder({ ...r, boots: 9, bootsAt: 2 })).toEqual([1, 2, 9, 3]);
    expect(buildOrder({ ...r, boots: 9, bootsAt: 3 })).toEqual([1, 2, 3, 9]);
  });

  it("offers situational legendary items after the core, one row per situation, each tagged right", () => {
    expect(p.situational.length).toBeGreaterThan(0);
    expect(p.situational.length).toBeLessThanOrEqual(5);
    const core = new Set(p.core[0].items);
    expect(new Set(p.situational.map((s) => s.situation)).size).toBe(p.situational.length);
    for (const s of p.situational) {
      expect(s.options.length).toBeGreaterThan(0);
      for (const o of s.options) {
        expect(o.tier).toBe("legendary");
        expect(core.has(o.items[0])).toBe(false);
        expect(itemSituation(o.items[0])).toBe(s.situation);
      }
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

  it("ranks every list on the champion page best DeepScore first (cores: among those with a real following)", () => {
    const p = championPage("Annie")!;
    const top = Math.max(...p.core.map((r) => r.pickRate));
    const followedCores = p.core.filter((r) => r.pickRate >= MIN_FOLLOWING * top);
    expect(p.core.slice(0, followedCores.length)).toEqual(followedCores);
    const scores = followedCores.map((r) => r.deepScore!);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    // Starting items come in up to three groups (build into the first core item, into the core, the rest), each
    // best DeepScore first.
    const starts = p.starting.map((r) => r.deepScore!);
    expect(starts.filter((x, i) => i > 0 && x > starts[i - 1]).length).toBeLessThanOrEqual(2);
  });

  it("opens Yasuo's core with the item his common start builds into (Cloak + Tome: Rite of Ruin)", () => {
    const p = championPage("Yasuo")!;
    expect(p.core[0].items[0] % 10000).toBe(3430);
    expect(p.cardStart?.items).toEqual(expect.arrayContaining([1018]));
  });
});
