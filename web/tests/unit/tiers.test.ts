import { describe, expect, it } from "vitest";
import { champStats, risersAndFallers, type PatchRow } from "@/lib/tiers";
import { grade, lowerBound, TIER_Z } from "@/lib/deepscore";

const row = (name: string, win_rate: number, pick_rate: number, patch = "16.20", days = 14): PatchRow => ({
  patch, days, name, win_rate, pick_rate, damage: null, tank: null, kp: null, dead: null, augs: "",
});

describe("champStats", () => {
  it("returns nothing for no rows or no chosen patches", () => {
    expect(champStats([], new Set(["16.20"]))).toEqual([]);
    expect(champStats([row("Ahri", 0.5, 0.1)], new Set(["16.19"]))).toEqual([]);
  });

  it("gives every champion a tier and a DeepScore, cut by spread", () => {
    const rows = Array.from({ length: 100 }, (_, i) => row(`C${i}`, 0.4 + i * 0.002, 0.05));
    const out = champStats(rows, new Set(["16.20"]));
    expect(out).toHaveLength(100);
    const order = TIER_Z.map(([t]) => t);
    // sorted best first: tiers never get better further down, and DeepScore never rises
    out.forEach((c, i) => {
      if (!i) return;
      expect(order.indexOf(c.tier)).toBeGreaterThanOrEqual(order.indexOf(out[i - 1].tier));
      expect(c.deepScore).toBeLessThanOrEqual(out[i - 1].deepScore);
    });
    expect(out[0].name).toBe("C99");
    expect(out[0].tier).toBe("S");
    expect(out.at(-1)!.tier).toBe("D");
    for (const t of order) expect(out.some((c) => c.tier === t)).toBe(true);
    const mean = out.reduce((s, c) => s + c.deepScore, 0) / out.length;
    expect(mean).toBeGreaterThan(48);
    expect(mean).toBeLessThan(52);
  });

  it("does not let a rarely picked champion top the list on a few lucky games", () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => row(`C${i}`, 0.5 + i * 0.001, 0.1)),
      row("Lucky", 0.7, 0.0005),
      row("Solid", 0.56, 0.2),
    ];
    const out = champStats(rows, new Set(["16.20"]));
    expect(out[0].name).toBe("Solid");
    const lucky = out.find((c) => c.name === "Lucky")!;
    expect(lucky.score).toBeLessThan(0.6);
    expect(lucky.win_rate).toBeCloseTo(0.7);
  });

  it("weights patches by pick rate times days, older patches at half, and keeps shares summing to 1", () => {
    const rows = [row("A", 0.6, 0.1, "16.19", 7), row("A", 0.4, 0.1, "16.20", 21), row("B", 0.5, 0.1, "16.19", 7), row("B", 0.5, 0.1, "16.20", 21)];
    const out = champStats(rows, new Set(["16.19", "16.20"]));
    const a = out.find((c) => c.name === "A")!;
    // 16.19's 7 days count as 3.5 next to 16.20's 21
    expect(a.win_rate).toBeCloseTo((0.6 * 3.5 + 0.4 * 21) / 24.5);
    expect(a.patches).toBe(2);
    expect(out.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1);
  });

  it("ignores missing and non-finite stats instead of returning NaN", () => {
    const rows = [{ ...row("A", 0.5, 0.1), damage: 0.3 }, { ...row("A", 0.5, 0.1, "16.21"), damage: Number.NaN }];
    const [a] = champStats(rows, new Set(["16.20", "16.21"]));
    expect(a.damage).toBeCloseTo(0.3);
    expect(a.tank).toBeNull();
  });

  it("names the latest patch's augments and skips unknown ids", () => {
    const rows = [{ ...row("A", 0.5, 0.1), augs: "not-an-augment" }];
    expect(champStats(rows, new Set(["16.20"]))[0].top_augments).toBe("");
  });
});

describe("risersAndFallers", () => {
  const c = (name: string, change: number) => ({ name, change });

  it("lists the biggest gains and the biggest drops, biggest first", () => {
    const list = [c("A", 0.02), c("B", -0.03), c("C", 0.05), c("D", -0.01), c("E", 0.01), c("F", -0.04)];
    const { up, down } = risersAndFallers(list, 2);
    expect(up.map((x) => x.name)).toEqual(["C", "A"]);
    expect(down.map((x) => x.name)).toEqual(["F", "B"]);
  });

  it("never lists a champion that rose among the drops, or one that fell among the gains", () => {
    // Fewer movers than two lists of five: the lists must not overlap or borrow from the other side.
    const { up, down } = risersAndFallers([c("A", 0.02), c("B", -0.03), c("C", 0.01)], 5);
    expect(up.map((x) => x.name)).toEqual(["A", "C"]);
    expect(down.map((x) => x.name)).toEqual(["B"]);
    expect(risersAndFallers([c("A", 0.02), c("B", 0.01)], 5).down).toEqual([]);
    expect(risersAndFallers([c("A", 0)], 5)).toEqual({ up: [], down: [] });
    expect(risersAndFallers([], 5)).toEqual({ up: [], down: [] });
  });
});

describe("DeepScore", () => {
  it("ranks a sure thing above a slightly better long shot", () => {
    expect(lowerBound(0.53, 20000, 0.5, 250)).toBeGreaterThan(lowerBound(0.54, 200, 0.5, 250));
  });

  it("puts the average at 50 and keeps scores within 0 to 100", () => {
    const g = grade([0.4, 0.5, 0.5, 0.5, 0.6, 0.9]);
    for (const { deepScore } of g) {
      expect(deepScore).toBeGreaterThanOrEqual(0);
      expect(deepScore).toBeLessThanOrEqual(100);
    }
    expect(grade([0.5, 0.5])[0]).toEqual({ deepScore: 50, tier: "B" });
    expect(grade([])).toEqual([]);
  });
});
