// Pentakill tab: every row is a champion with a page, the start pick is a basic ability, the level 18 pick is
// another ability (the ultimate allowed) and both come with the champion's own ability name and icon.
import { describe, expect, it } from "vitest";
import championIds from "@/data/champion-ids.json";
import { championUpgrades } from "@/lib/champion-upgrades";
import { championAliases } from "@/lib/champions";
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
      expect(Number.isFinite(r.boost + r.startGain + r.level18Gain + r.margin), r.champion).toBe(true);
    }
  });

  it("names a runner-up that isn't the start pick, with its ability name", () => {
    for (const r of rows) {
      expect(["Q", "W", "E"], r.champion).toContain(r.runnerUp);
      expect(r.runnerUp, r.champion).not.toBe(r.start);
      expect(r.runnerUpName, r.champion).toBeTruthy();
    }
  });

  it("comes sorted by boost, then by champion", () => {
    for (let k = 1; k < rows.length; k++) {
      const [a, b] = [rows[k - 1], rows[k]];
      expect(a.boost > b.boost || (a.boost === b.boost && a.champion < b.champion), `${a.champion} before ${b.champion}`).toBe(true);
    }
  });

  it("gives the same rows on every call, read once", () => {
    expect(pentakill()).toBe(rows);
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
      expect(Number.isFinite(u!.augments!.boost + u!.augments!.synergy + u!.destiny!.gain + u!.destiny!.takedowns), alias).toBe(true);
    }
  });

  it("gives nothing for a champion the site doesn't know, nor for another mode's Jade_ stand-ins", () => {
    expect(championUpgrades("NotAChampion")).toBeNull();
    expect(championUpgrades("Jade_Aatrox")).toBeNull();
    // Every real champion with picks gets a panel, and the panel's picks are the tab's row.
    const byAlias = new Map(pentakill().map((r) => [r.champion, r]));
    for (const alias of championAliases()) expect(championUpgrades(alias)?.pentakill ?? null, alias).toBe(byAlias.get(alias) ?? null);
  });
});
