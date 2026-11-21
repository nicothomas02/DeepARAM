import { describe, expect, it } from "vitest";
import { comboPotential, type SynergyPair } from "@/lib/synergy-picks";

// Combo potential: a confirmed partner still to come is worth part of the pair while picks remain (Nico 2026-11-21).
describe("combo potential", () => {
  const pairs: SynergyPair[] = [
    { a: 1, b: 2, points: 2, rule: true }, // Ethereal Weapon + Mystic Punch style
    { a: 1, b: 3, points: 5, rule: false }, // Simulator only: never counts
    { a: 4, b: 5, points: 3, order: [3, 0], rule: true }, // only 4 first works
  ];
  const pool = new Set([1, 2, 3, 4, 5]);

  it("gives 60% of a confirmed pair with nothing taken, and ignores Simulator-only pairs", () => {
    const m = comboPotential(pairs, [], pool, 4);
    expect(m.get(1)).toEqual({ with: 2, points: 1.2 });
    expect(m.get(2)).toEqual({ with: 1, points: 1.2 });
    expect(m.has(3)).toBe(false);
    expect(m.get(4)?.points).toBeCloseTo(1.8);
    expect(m.has(5)).toBe(false);
  });

  it("shrinks as picks run out, and drops pairs whose partner is taken or out of the pool", () => {
    expect(comboPotential(pairs, [9, 8], pool, 4).get(1)?.points).toBeCloseTo(0.5);
    expect(comboPotential(pairs, [9, 8, 7], pool, 4).size).toBe(0);
    expect(comboPotential(pairs, [2], pool, 4).has(1)).toBe(false);
    expect(comboPotential(pairs, [], new Set([1, 3]), 4).has(1)).toBe(false);
  });
});
