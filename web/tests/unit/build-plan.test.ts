import { describe, expect, it } from "vitest";
import { buildStyle, rushParts, styleCores, tiedWith, upgradeSwaps } from "@/lib/build-plan";

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
});
