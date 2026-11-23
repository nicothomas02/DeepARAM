import { describe, expect, it } from "vitest";
import { alongCore, followed, laterItems, skipsBoots, slotItems, type ItemRow } from "@/lib/card-score";

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
