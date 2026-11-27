import { describe, expect, it } from "vitest";
import { alongCore, augmentPrior, followed, priorLeads, fullPicks, realFullPicks, laterItems, skipsBoots, slotItems, type ItemRow } from "@/lib/card-score";

describe("followed", () => {
  it("keeps a rare build from leading the list", () => {
    const rows = [
      { id: "ap", pickRate: 0.009 },
      { id: "tank", pickRate: 0.118 },
      { id: "mixed", pickRate: 0.04 },
    ];
    expect(followed(rows).map((r) => r.id)).toEqual(["tank", "mixed", "ap"]);
  });
  it("leaves close rows in their order", () => {
    const rows = [
      { id: "a", pickRate: 0.03 },
      { id: "b", pickRate: 0.033 },
    ];
    expect(followed(rows).map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("alongCore", () => {
  const full = [{ items: [1, 2, 3, 4, 5, 6] }, { items: [10, 11, 12, 13, 14, 15] }];
  it("puts items bought with the core first", () => {
    const pool = [{ items: [13] }, { items: [5] }, { items: [4] }];
    expect(alongCore(pool, [1, 2, 3], full).map((r) => r.items[0])).toEqual([5, 4, 13]);
  });
  it("keeps the pool when no build has the core", () => {
    const pool = [{ items: [13] }, { items: [5] }];
    expect(alongCore(pool, [7, 8, 9], full)).toEqual(pool);
  });
});

describe("skipsBoots", () => {
  const isBoots = (i: number) => i === 99;
  it("skips when few buy boots and most six-item builds have none", () => {
    const full = [{ items: [1, 2, 3, 4, 5, 6], pickRate: 0.2 }, { items: [1, 2, 3, 4, 5, 99], pickRate: 0.01 }];
    expect(skipsBoots([{ pickRate: 0.05 }], full, isBoots)).toBe(true);
  });
  it("keeps boots when most builds have them", () => {
    const full = [{ items: [1, 2, 3, 4, 5, 99], pickRate: 0.2 }, { items: [1, 2, 3, 4, 5, 6], pickRate: 0.1 }];
    expect(skipsBoots([{ pickRate: 0.2 }], full, isBoots)).toBe(false);
    expect(skipsBoots([{ pickRate: 0.6 }], [{ items: [1, 2, 3, 4, 5, 6], pickRate: 0.2 }], isBoots)).toBe(false);
  });
});

describe("items after the core", () => {
  const row = (id: number, pickRate: number, deepScore: number): ItemRow => ({ items: [id], pickRate, winRate: 0.5, lift: 0, deepScore });
  const core: ItemRow = { items: [1, 2, 3], boots: 9, pickRate: 0.2, winRate: 0.5, lift: 0 };
  const pool = [row(2, 0.5, 70), row(9, 0.5, 70), row(10, 0.3, 60), row(11, 0.25, 58), row(12, 0.2, 55), row(13, 0.01, 90)];
  const none = () => [];
  it("lists single items after the core, leaving out the core and boots, followed items first", () => {
    expect(laterItems(pool, core, none).map((r) => r.items[0])).toEqual([10, 11, 12, 13]);
  });
  it("splits them into the 4th, 5th and 6th slots by buying order", () => {
    // Counts at slots 1..6: 10 is a 4th item, 11 a 5th or 6th, 12 a 6th.
    const all = { "10": [0, 0, 5, 80, 15, 5], "11": [0, 0, 0, 10, 50, 40], "12": [0, 0, 0, 5, 15, 80] };
    const slots = slotItems(pool, core, none, undefined, all)!;
    expect(slots.map((s) => s.slot)).toEqual([4, 5, 6]);
    expect(slots[0].items[0].items[0]).toBe(10);
    expect(slots[1].items.map((r) => r.items[0])).toContain(11);
    expect(slots[2].items.map((r) => r.items[0])).toEqual(expect.arrayContaining([11, 12]));
  });
  it("leans on the champion's own counts once it has enough of them", () => {
    const all = { "10": [0, 0, 0, 80, 15, 5], "11": [0, 0, 0, 10, 50, 40], "12": [0, 0, 0, 5, 15, 80] };
    const champ = { "10": [0, 0, 0, 0, 2, 60] };
    const slots = slotItems(pool, core, none, champ, all)!;
    expect(slots[2].items[0].items[0]).toBe(10);
  });
  it("gives nothing without buying-order data", () => {
    expect(slotItems(pool, core, none, undefined, undefined)).toBeNull();
    expect(slotItems(pool, core, none, undefined, {})).toBeNull();
  });
});

describe("fullPicks", () => {
  const r = (id: number, deepScore: number): ItemRow => ({ items: [id], pickRate: 0.1, winRate: 0.5, lift: 0, deepScore });
  it("fills the build to six with each slot's best DeepScore item, never twice", () => {
    const core: ItemRow = { items: [1, 2, 3], pickRate: 0.1, winRate: 0.5, lift: 0, boots: 9 };
    const slots = [
      { slot: 4, items: [r(4, 60), r(5, 70)] },
      { slot: 5, items: [r(5, 80), r(6, 50)] },
    ];
    expect(fullPicks(core, slots, [r(7, 40)]).map((x) => x.items[0])).toEqual([5, 6]);
  });
  it("falls back to the later list when a slot is missing", () => {
    const core: ItemRow = { items: [1, 2, 3], pickRate: 0.1, winRate: 0.5, lift: 0 };
    expect(fullPicks(core, undefined, [r(7, 40), r(8, 65), r(9, 50)]).map((x) => x.items[0])).toEqual([8, 9, 7]);
  });
});

describe("realFullPicks", () => {
  const row = (items: number[], pickRate: number, deepScore: number): ItemRow => ({ items, pickRate, winRate: 0.5, lift: 0, deepScore });
  const single = [4, 5, 6, 7, 8].map((i) => row([i], 0.1, 50));
  const core: ItemRow = { items: [1, 2, 3], pickRate: 0.1, winRate: 0.5, lift: 0, boots: 9 };
  const isBoots = (i: number) => i === 9;
  it("takes the best scoring real build with a following that holds the core, in slot order", () => {
    const builds = [row([1, 2, 3, 9, 4, 5], 0.04, 60), row([1, 2, 3, 9, 6, 7], 0.02, 80), row([1, 2, 3, 9, 7, 8], 0.005, 99), row([1, 2, 8, 9, 4, 5], 0.05, 90)];
    const slots = [{ slot: 4, items: [row([7], 0.1, 50)] }, { slot: 5, items: [row([6], 0.1, 50)] }];
    expect(realFullPicks(core, builds, single, slots, isBoots)?.map((r) => r.items[0])).toEqual([7, 6]);
  });
  it("returns null when no followed build holds the core", () => {
    expect(realFullPicks(core, [row([1, 2, 8, 9, 4, 5], 0.05, 90)], single, undefined, isBoots)).toBeNull();
  });
});

describe("augment cross-champion prior", () => {
  const fit = { b: 0.95, k: 0, s0: 0.00857, s1: 0, q50: 0.4, q80: 0.9, q95: 2 };
  const row = (id: number, winRate: number, games: number) => ({ id, winRate, games, pickRate: games });
  it("takes an augment's prior from the other champions only", () => {
    const lists = {
      a: [row(1, 0.6, 5000), row(2, 0.5, 5000)],
      b: [row(1, 0.56, 5000), row(2, 0.5, 5000)],
    };
    const mu = augmentPrior(lists);
    // On a, augment 1's prior comes from b's +3 pt lead (shrunk a little), not from a's own +5 pts.
    expect(mu("a", 1)).toBeGreaterThan(0.02);
    expect(mu("a", 1)).toBeLessThan(0.03);
    expect(mu("b", 1)).toBeGreaterThan(mu("a", 1));
    expect(mu("c", 1)).toBe(0);
  });
  it("reduces to the shrunk lead with no prior and no penalty", () => {
    const list = [row(1, 0.55, 2000), row(2, 0.5, 2000), row(3, 0.47, 2000)];
    const out = priorLeads(list, () => 0, fit, 0);
    expect(out.get(1)!).toBeGreaterThan(0);
    expect(out.get(3)!).toBeLessThan(0);
    expect(out.get(1)! / 0.95).toBeLessThan(0.55 - 0.5067);
  });
  it("lifts a thin row of an augment that is strong on other champions", () => {
    const list = [row(1, 0.52, 150), row(2, 0.52, 150), row(3, 0.5, 6000), row(4, 0.49, 6000)];
    const out = priorLeads(list, (id) => (id === 1 ? 0.03 : id === 2 ? -0.03 : 0), fit);
    expect(out.get(1)!).toBeGreaterThan(out.get(2)!);
  });
});
