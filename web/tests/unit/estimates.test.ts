import { describe, expect, it } from "vitest";
import { augmentSpread, augmentStages, championAugmentReliance, estimatesFeedOnly, funLists, itemEstimate, powerCurveLists, rarityOdds, typicalGame } from "@/lib/estimates";

// Feed-only estimates (Nico, 2026-11-20: public numbers come only from the live stats) leave out everything counted or
// fitted on the owner's games; the checks below cover both builds.
const feedOnly = estimatesFeedOnly();

// Estimated stats the site shows (lib/estimates.ts), read from data/estimates/estimates.json.
describe("estimates", () => {
  it("gives items a win rate, build share and slot list even when slots are missing", () => {
    const est = itemEstimate(3084);
    expect(est).not.toBeNull();
    expect(est!.winRate).toBeGreaterThan(0.3);
    expect(est!.winRate).toBeLessThan(0.7);
    expect(Array.isArray(est!.slots)).toBe(true);
    expect(itemEstimate(-1)).toBeNull();
  });

  it("splits an augment's picks over the four stages", () => {
    const s = augmentStages(1009);
    if (feedOnly) return expect(s).toBeNull();
    expect(s?.stages).toHaveLength(4);
    expect(s!.stages.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1);
  });

  it("reads rarity odds whatever the case of the rarity", () => {
    if (feedOnly) return expect(rarityOdds("gold")).toBeNull();
    expect(rarityOdds("gold")?.byStage).toHaveLength(4);
    expect(rarityOdds("Gold")?.overall).toBe(rarityOdds("gold")?.overall);
  });

  it("has a typical game and top 10 lists", () => {
    const g = typicalGame();
    for (const ids of Object.values(funLists())) expect(ids.length).toBeLessThanOrEqual(10);
    if (feedOnly) {
      expect(g).toBeNull();
      // Only the lists the live stats rank on are left.
      expect(Object.keys(funLists()).sort()).toEqual(["damage", "tank", "teamplay"]);
      return;
    }
    expect(g!.minutes).toBeGreaterThan(10);
    expect(g!.blue + g!.red).toBeCloseTo(1, 2);
    for (const ids of Object.values(funLists())) expect(ids.length).toBeLessThanOrEqual(10);
  });

  it("reads the power curve, or nothing when it isn't built yet", () => {
    const c = powerCurveLists();
    expect(c.early.length).toBeLessThanOrEqual(10);
    expect(c.late.length).toBeLessThanOrEqual(10);
    for (const id of c.early) expect(c.scaling.get(id)!).toBeLessThan(0);
    for (const id of c.late) expect(c.scaling.get(id)!).toBeGreaterThan(0);
  });

  it("gives augments a spread across champions and champions a reliance on augments, in a sane range", () => {
    const reliance = championAugmentReliance();
    if (feedOnly) {
      expect(reliance.size).toBe(0);
      expect(augmentSpread(1053)).toBeNull();
      return;
    }
    expect(reliance.size).toBeGreaterThan(100);
    for (const v of reliance.values()) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(0.15);
    }
    // Mad Scientist (1053) is taken by every champion; an unknown id has none.
    expect(augmentSpread(1053)).toBeGreaterThan(0);
    expect(augmentSpread(-1)).toBeNull();
  });
});
