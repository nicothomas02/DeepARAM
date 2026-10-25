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
    const strong = synergy(0.6, 0.55, 0.55); // wins 60%, but 59.9% was expected
    const helping = synergy(0.55, 0.49, 0.5); // below-average champions that win 55% together
    expect(helping).toBeGreaterThan(strong);
    expect(Math.abs(strong)).toBeLessThan(0.001);
  });

  it("goes below zero for pairs that get in each other's way", () => {
    expect(synergy(0.5, 0.53, 0.53)).toBeLessThan(0);
  });
});
