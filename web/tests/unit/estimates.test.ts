import { describe, expect, it } from "vitest";
import { augmentStages, funLists, itemEstimate, powerCurve, rarityOdds, typicalGame } from "@/lib/estimates";

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
    expect(s?.stages).toHaveLength(4);
    expect(s!.stages.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1);
  });

  it("reads rarity odds whatever the case of the rarity", () => {
    expect(rarityOdds("gold")?.byStage).toHaveLength(4);
    expect(rarityOdds("Gold")?.overall).toBe(rarityOdds("gold")?.overall);
  });

  it("has a typical game and top 10 lists", () => {
    const g = typicalGame();
    expect(g!.minutes).toBeGreaterThan(10);
    expect(g!.blue + g!.red).toBeCloseTo(1, 2);
    for (const ids of Object.values(funLists())) expect(ids.length).toBeLessThanOrEqual(10);
  });

  it("reads the power curve, or nothing when it isn't built yet", () => {
    const c = powerCurve();
    expect(c.early.length).toBeLessThanOrEqual(10);
    expect(c.late.length).toBeLessThanOrEqual(10);
    for (const id of c.early) expect(c.scaling.get(id)!).toBeLessThan(0);
    for (const id of c.late) expect(c.scaling.get(id)!).toBeGreaterThan(0);
  });
});
