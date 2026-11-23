// Pentakill tab: every row is a champion with a page, the start pick is a basic ability, the level 18 pick is
// another ability (the ultimate allowed), both come with the champion's own ability name and icon, and the picks
// come from real games (AramHex).
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

  it("scores from real games, and a close call is another basic ability", () => {
    // Since AramHex (2026-11-23): DeepScores in range, real games behind every row.
    for (const r of rows) {
      for (const v of [r.startScore, r.level18Score]) {
        expect(v, r.champion).toBeGreaterThanOrEqual(0);
        expect(v, r.champion).toBeLessThanOrEqual(100);
      }
      expect(r.games, r.champion).toBeGreaterThanOrEqual(200);
      if (r.closeCall) {
        expect(["Q", "W", "E"], r.champion).toContain(r.closeCall);
        expect(r.closeCall, r.champion).not.toBe(r.start);
      }
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
      expect(typeof u!.augments!.simulated, alias).toBe("boolean");
      expect(pages.get(u!.destiny!.id)?.tier, alias).toBe("legendary");
      expect(u!.pentakill!.champion).toBe(alias);
    }
  });
});
