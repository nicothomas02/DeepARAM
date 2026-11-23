import { describe, expect, it } from "vitest";
import { buildStyle, buyingOrder, restOfBuild, rushParts, startFirst, starterFits, styleCores, tiedWith, upgradeSwaps } from "@/lib/build-plan";

const classes: Record<number, string[]> = { 1: ["tank"], 2: ["tank"], 3: ["tank", "fighter"], 4: ["mage"], 5: ["mage"], 6: ["mage"] };
const of = (i: number) => classes[i] ?? [];

describe("build plan", () => {
  it("reads a core's style from its items' shop classes", () => {
    expect(buildStyle([1, 2, 3], of)).toBe("tank");
    expect(buildStyle([4, 5, 6], of)).toBe("ap");
  });
  it("gives style tabs only when a second style has a real following", () => {
    const tank = { items: [1, 2, 3], pickRate: 0.1 };
    expect(styleCores([tank, { items: [4, 5, 6], pickRate: 0.04 }], of).map((s) => s.style)).toEqual(["tank", "ap"]);
    expect(styleCores([tank, { items: [4, 5, 6], pickRate: 0.009 }], of)).toEqual([]);
  });
  it("rushes the priciest parts first", () => {
    const r: Record<number, { from?: number[]; price: number }> = { 10: { from: [11, 12, 13], price: 3000 }, 11: { price: 400 }, 12: { price: 1300 }, 13: { price: 875 } };
    expect(rushParts(10, (i) => r[i])).toEqual([12, 13]);
  });
  it("matches Upgrade augments to the champion's items", () => {
    const items = [{ id: 1, name: "Infinity Edge" }, { id: 2, name: "Zhonya's Hourglass" }, { id: 3, name: "The Collector" }];
    const augs = [
      { id: 9, name: "Upgrade Zhonya's", pickRate: 0.1 },
      { id: 8, name: "Upgrade Collector", pickRate: 0.05 },
      { id: 7, name: "Upgrade Stormsurge", pickRate: 0.2 },
    ];
    expect(upgradeSwaps(augs, items)).toEqual([{ augment: 9, item: 2 }, { augment: 8, item: 3 }]);
  });
  it("calls close win rates tied only within noise", () => {
    expect(tiedWith({ winRate: 0.55, games: 9000 }, { winRate: 0.545, games: 9000 })).toBe(true);
    expect(tiedWith({ winRate: 0.55, games: 90000 }, { winRate: 0.53, games: 90000 })).toBe(false);
    expect(tiedWith({ winRate: 0.55 }, { winRate: 0.55 })).toBe(false);
  });

  // Yasuo-like: Rite of Ruin (30) is built from Cloak (1) and Tome (2); Infinity Edge (31) has Cloak; Death's Dance (32) neither.
  const parts: Record<number, number[]> = { 30: [1, 2, 3], 31: [1, 4], 32: [5, 6], 40: [7] };
  const partsOf = (i: number) => parts[i] ?? [];
  const standalone = (i: number) => i === 9; // a starter item like Guardian's Blade
  it("checks a start builds into the core, the boots, or is a standalone starter", () => {
    expect(starterFits([1, 2], [31, 32, 30], partsOf, standalone)).toBe(true);
    expect(starterFits([1, 9], [31, 32], partsOf, standalone)).toBe(true);
    expect(starterFits([7], [31, 32, 30, 40], partsOf, standalone)).toBe(true);
    expect(starterFits([8], [31, 32, 30], partsOf, standalone)).toBe(false);
  });
  it("opens the core with the one item a start builds into", () => {
    expect(startFirst([31, 32, 30], [1, 2], partsOf, standalone)).toEqual([30, 31, 32]);
    // one part alone, or parts two items share, say nothing about order
    expect(startFirst([31, 32, 30], [1, 9], partsOf, standalone)).toEqual([31, 32, 30]);
  });
  it("orders a core by how players bought it, leaving pairs nobody ordered alone", () => {
    const rows = [
      { items: [30, 31, 50], weight: 0.07 },
      { items: [31, 30, 50], weight: 0.02 },
      { items: [30, 32, 50], weight: 0.03 },
    ];
    expect(buyingOrder([31, 32, 30], rows)).toEqual({ items: [30, 31, 32], known: true });
    expect(buyingOrder([31, 32], [{ items: [60, 61], weight: 1 }])).toEqual({ items: [31, 32], known: false });
  });
  it("fills the rest of a six-item build with what's bought with the core, without boots", () => {
    const full = [
      { items: [30, 31, 32, 1001, 41, 42], pickRate: 0.05 },
      { items: [30, 31, 32, 1001, 41, 43], pickRate: 0.03 },
      { items: [30, 31, 44, 45, 46, 47], pickRate: 0.2 },
    ];
    expect(restOfBuild([30, 31, 32], 1001, full, (i) => i === 1001)).toEqual([41, 42]);
    expect(restOfBuild([30, 31, 32], undefined, full, (i) => i === 1001)).toEqual([41, 42, 43]);
  });
  it("fills slots the whole-core builds leave empty from builds sharing most of the core", () => {
    const full = [
      { items: [30, 31, 32, 1001, 41], pickRate: 0.05 },
      { items: [30, 31, 1001, 41, 48, 49], pickRate: 0.04 },
      { items: [60, 61, 62, 63, 64, 65], pickRate: 0.5 },
    ];
    expect(restOfBuild([30, 31, 32], 1001, full, (i) => i === 1001)).toEqual([41, 48]);
  });
});
