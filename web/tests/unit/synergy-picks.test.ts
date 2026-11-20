import { describe, expect, it } from "vitest";
import { synergyWith, type SynergyPair } from "@/lib/synergy-picks";

// Ethereal Weapon 1029, Mystic Punch 1058, Juiced 2, Deft 3 (ids only matter as numbers here).
const pairs: SynergyPair[] = [
  { a: 1029, b: 1058, points: 2, rule: true, why: "Ability hits apply on-hit." },
  { a: 1029, b: 2, points: 0.5, rule: false },
  { a: 3, b: 1058, points: -0.4, rule: false },
];

describe("re-ranking augments after a pick", () => {
  it("adds nothing before anything is taken", () => expect(synergyWith(pairs, []).size).toBe(0));

  it("raises Mystic Punch once Ethereal Weapon is taken, either way round", () => {
    const after = synergyWith(pairs, [1029]);
    expect(after.get(1058)?.total).toBeCloseTo(0.02);
    expect(after.get(1058)?.parts[0]).toEqual({ with: 1029, points: 2, why: "Ability hits apply on-hit." });
    expect(after.get(2)?.total).toBeCloseTo(0.005);
    expect(synergyWith(pairs, [1058]).get(1029)?.total).toBeCloseTo(0.02);
  });

  it("adds up synergy with several taken augments, overlaps included", () => {
    const after = synergyWith(pairs, [1058, 3]);
    expect(after.get(1029)?.total).toBeCloseTo(0.02);
    expect(after.has(3)).toBe(false); // already taken
  });

  it("sums several pairs for one augment, biggest first", () => {
    const after = synergyWith(pairs, [1029, 3]);
    expect(after.get(1058)?.total).toBeCloseTo(0.016);
    expect(after.get(1058)?.parts.map((p) => p.with)).toEqual([1029, 3]);
  });

  it("follows pick order where it decides (One Hit Wonder before Purist Caster clashes, after doesn't)", () => {
    const order: SynergyPair[] = [{ a: 10, b: 20, points: 0, order: [-1.5, 0], rule: true }];
    expect(synergyWith(order, [10]).get(20)?.total).toBeCloseTo(-0.015);
    expect(synergyWith(order, [20]).has(10)).toBe(false);
  });
});
