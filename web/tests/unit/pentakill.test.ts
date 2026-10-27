// Pentakill tab: every row is a champion with a page, the start pick is a basic ability, the level 18 pick is
// another ability (the ultimate allowed) and both come with the champion's own ability name and icon.
import { describe, expect, it } from "vitest";
import championIds from "@/data/champion-ids.json";
import { pentakill } from "@/lib/pentakill";

describe("Pentakill picks", () => {
  const rows = pentakill();

  it("covers most champions", () => {
    expect(rows.length).toBeGreaterThan(150);
    for (const r of rows) expect(championIds, r.champion).toHaveProperty(r.champion);
  });

  it("picks a basic ability first and another one at level 18", () => {
    for (const r of rows) {
      expect(["Q", "W", "E"], r.champion).toContain(r.start);
      expect(["Q", "W", "E", "R"], r.champion).toContain(r.level18);
      expect(r.level18, r.champion).not.toBe(r.start);
      expect(r.startName && r.level18Name, r.champion).toBeTruthy();
      expect(r.startIcon, r.champion).toMatch(/^\/assets\//);
    }
  });

  it("keeps the boost in line with the simulated gains", () => {
    for (const r of rows) {
      // The start pick is the best of the three, so it never loses to doing nothing by much.
      expect(r.startGain, r.champion).toBeGreaterThan(-0.02);
      expect(Math.abs(r.boost), r.champion).toBeLessThan(0.05);
      expect(Math.sign(r.boost) || 1, r.champion).toBe(Math.sign(r.startGain + 0.35 * r.level18Gain) || 1);
      expect(r.margin, r.champion).toBeGreaterThanOrEqual(0);
    }
  });
});
