// Pentakill tab: every row is a champion with a page, the start pick is a basic ability, the level 18 pick is
// another ability (the ultimate allowed) and both come with the champion's own ability name and icon.
import { describe, expect, it } from "vitest";
import championIds from "@/data/champion-ids.json";
import { championUpgrades } from "@/lib/champion-upgrades";
import { itemPages } from "@/lib/item-pages";
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

describe("Best upgrades on champion pages", () => {
  it("gives most champions 4 augments, a Legendary Weapon of Destiny and their Pentakill picks", () => {
    const all = Object.keys(championIds).map((alias) => [alias, championUpgrades(alias)] as const);
    const full = all.filter(([, u]) => u?.augments && u.destiny && u.pentakill);
    expect(full.length).toBeGreaterThan(150);
    const pages = new Map(itemPages().map((i) => [i.id, i]));
    for (const [alias, u] of full) {
      expect(new Set(u!.augments!.ids).size, alias).toBe(4);
      expect(pages.get(u!.destiny!.id)?.tier, alias).toBe("legendary");
      expect(u!.pentakill!.champion).toBe(alias);
    }
  });
});
