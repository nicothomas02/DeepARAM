import { describe, expect, it } from "vitest";
import { augmentRanges, itemHistory, statRanges } from "@/lib/stat-ranges";
import { championRanges } from "@/lib/champions";
import { itemBuilderRanges } from "@/lib/item-pages";

describe("stat ranges", () => {
  it("offers live patch, last patch, this set and all time, oldest patch first", () => {
    expect(statRanges(["16.19", "16.20", "16.21", "16.22"]).map((r) => [r.key, r.patches])).toEqual([
      ["live", ["16.22"]],
      ["prev", ["16.21"]],
      ["set", ["16.21", "16.22"]],
      ["all", ["16.19", "16.20", "16.21", "16.22"]],
    ]);
  });
  it("leaves out a range that repeats another", () => {
    // A set's first patch: "this set" is just the live patch.
    expect(statRanges(["16.20", "16.21"]).map((r) => r.key)).toEqual(["live", "prev", "all"]);
    expect(statRanges(["16.21"]).map((r) => r.key)).toEqual(["live"]);
    expect(statRanges([])).toEqual([]);
  });
  it("scores a champion over each range like the Tier List", () => {
    const ranges = championRanges("Ahri");
    expect(ranges[0].key).toBe("live");
    for (const r of ranges) {
      expect(r.winRate).toBeGreaterThan(0.3);
      expect(r.winRate).toBeLessThan(0.7);
      expect(r.rank).toBeGreaterThanOrEqual(1);
      expect(r.rank).toBeLessThanOrEqual(r.of);
    }
    expect(ranges.map((r) => r.key)).toContain("all");
  });
  it("combines saved augment and item patches", () => {
    const { ranges, stats } = augmentRanges();
    expect(ranges.length).toBeGreaterThan(1);
    const some = [...stats.values()].find((s) => s.all);
    expect(some?.all?.winRank).toBeGreaterThanOrEqual(1);
    expect(itemHistory().length).toBeGreaterThan(1);
    const items = itemBuilderRanges();
    const built = [...items.builders.values()].find((b) => (b.all?.length ?? 0) > 0)!;
    expect(built.all![0].pickRate).toBeGreaterThan(0);
    expect(built.all![0].pickRate).toBeLessThanOrEqual(1);
  });
});
