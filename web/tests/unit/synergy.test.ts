import { describe, expect, it } from "vitest";
import { expectedPairWinRate, synergy } from "@/lib/synergy";

// Duo synergy (lib/synergy.ts): rewards pairs that win more than their own win rates predict.
describe("duo synergy", () => {
  it("expects two average champions to win half their games, and two strong ones more", () => {
    expect(expectedPairWinRate(0.5, 0.5)).toBeCloseTo(0.5);
    expect(expectedPairWinRate(0.55, 0.55)).toBeCloseTo(0.599, 3);
    expect(expectedPairWinRate(0.55, 0.45)).toBeCloseTo(0.5);
  });

  it("ranks a pair that lifts each other above two strong champions who only win alone", () => {
    const strong = synergy(0.6, 0.55, 0.55, 0.012); // wins 60%, but 59.9% was expected
    const helping = synergy(0.55, 0.49, 0.5, 0.012); // average champions that win 55% together
    expect(helping).toBeGreaterThan(strong);
    expect(Math.abs(strong)).toBeLessThan(0.001);
  });

  it("pulls rarely picked pairs toward zero", () => {
    expect(Math.abs(synergy(0.6, 0.5, 0.5, 0.002))).toBeLessThan(Math.abs(synergy(0.6, 0.5, 0.5, 0.02)));
  });
});
