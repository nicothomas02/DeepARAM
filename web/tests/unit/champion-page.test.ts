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

  it("orders Yasuo's core the way players buy it (Yun Tal, Rite of Ruin, Death's Dance), with a start that builds into it", () => {
    const p = championPage("Yasuo")!;
    expect(p.core[0].items.map((i) => i % 10000)).toEqual([3032, 3430, 6333]);
    expect(p.cardStart?.items).toEqual(expect.arrayContaining([1018]));
  });

  it("keeps tear builds the six-item builds can't show (Kassadin: Rod of Ages + Archangel's Staff)", () => {
    const p = championPage("Kassadin")!;
    expect(p.coreFromEarlier).toBe(true);
    expect(p.core[0].items.map((i) => i % 10000)).toEqual(expect.arrayContaining([3003]));
    // Annie's earlier cores are still backed by today's six-item builds, so they stay too (see the Yunara case).
    expect(championPage("Annie")!.coreFromEarlier).toBe(true);
  });

  it("keeps the item bought first that six-item builds rank low (Yunara: Yun Tal first, Nico 2026-11-21)", () => {
    const p = championPage("Yunara")!;
    expect(p.coreFromEarlier).toBe(true);
    expect(p.core[0].items[0] % 10000).toBe(3032);
  });
});

// Build styles on the card (Nico 2026-11-21: crit vs AP Ashe, everything follows the build, best DeepScore first).
describe("champion card builds by style", () => {
  it("gives Ashe a crit and an AP build, best DeepScore first, each with its own core", () => {
    const p = championPage("Ashe")!;
    const styles = p.builds.map((b) => b.style);
    expect(styles).toEqual(expect.arrayContaining(["crit", "ap"]));
    const scores = p.builds.map((b) => b.deepScore);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(p.builds.filter((b) => b.main)).toHaveLength(1);
    const crit = p.builds.find((b) => b.style === "crit")!;
    expect(crit.core.items.map((i) => i % 10000)).toEqual(expect.arrayContaining([3031]));
    expect(new Set(p.builds.map((b) => b.core.items.join())).size).toBe(p.builds.length);
    for (const b of p.builds) for (const i of b.core.items) expect(p.itemInfo[i]?.name).toBeTruthy();
  });

  it("has no build tabs for a one-style champion", () => {
    expect(championPage("Annie")!.builds).toEqual([]);
  });
});

// Build lists with real games (Nico 2026-11-21): popularity adds certainty, never score by itself.
describe("DeepScore with real games", () => {
  it("doesn't rank a popular row above an equally winning rare one, and still trusts a big sample", () => {
    const ranked = scoreRows([
      { id: "popular", winRate: 0.52, pickRate: 0.5, games: 50000 },
      { id: "rare", winRate: 0.52, pickRate: 0.05, games: 5000 },
      { id: "lucky", winRate: 0.7, pickRate: 0.0005, games: 50 },
      { id: "weak", winRate: 0.47, pickRate: 0.3, games: 30000 },
    ]);
    const ds = Object.fromEntries(ranked.map((r) => [r.id, r.deepScore!]));
    expect(Math.abs(ds.popular - ds.rare)).toBeLessThanOrEqual(3);
    expect(ds.weak).toBeLessThan(ds.rare);
  });
});

