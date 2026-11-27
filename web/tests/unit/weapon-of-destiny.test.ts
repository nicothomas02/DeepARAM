// Weapon of Destiny tab: every ranked item is a Legendary item with a page, its per-takedown stats add up to the
// augment's 200 gold, and the tiers follow the DeepScore from real games with the augment (AramHex, 2026-11-23).
import { describe, expect, it } from "vitest";
import championIds from "@/data/champion-ids.json";
import { itemPages } from "@/lib/item-pages";
import { destinyByChampion, weaponOfDestiny } from "@/lib/weapon-of-destiny";

describe("Weapon of Destiny ranking", () => {
  const data = weaponOfDestiny()!;
  const pages = new Map(itemPages().map((i) => [i.id, i]));

  it("ranks the Legendary items players make their Weapon, with real games", () => {
    expect(data.gold).toBe(200);
    // AramHex lists each champion's Weapon items with 1,000+ games and 2%+ of its holders (16.23 seq 22, a two-day
    // window: 23 items; 16.22 had 30+).
    expect(data.rows.length).toBeGreaterThan(15);
    for (const r of data.rows) expect(r.games, r.name).toBeGreaterThan(0);
    // Items without a page (Mayhem's Hubris) are Legendary items only seen in core builds: some champion buys them first.
    for (const r of data.rows) if (r.slug) expect(pages.get(r.id)?.tier, r.name).toBe("legendary");
    else expect(r.share, r.name).toBeGreaterThan(0);
  });

  it("gives each item only upgradeable stats, shared equally", () => {
    // One takedown's worth of a single stat, from the augment's values (1,000 gold buys 30 AD, 375 Health ...;
    // 26.22 cut Lethality from 35 to 20 per 1,000 gold).
    const alone: Record<string, number> = { ad: 6, ap: 10, hp: 75, armor: 10, mr: 10, ah: 4, crit: 0.05, as: 0.08, lethality: 4, lifesteal: 0.05 };
    for (const r of data.rows) {
      const keys = Object.keys(r.perTakedown);
      for (const k of keys) if (k in alone) expect(r.perTakedown[k], `${r.name} ${k}`).toBeCloseTo(alone[k] / keys.length, 4);
    }
  });

  it("tiers a higher DeepScore at least as high, with shares that add up", () => {
    const order = ["S", "A", "B", "C", "D"];
    const scored = [...data.rows].sort((a, b) => b.rank - a.rank);
    for (let k = 1; k < scored.length; k++) {
      expect(order.indexOf(scored[k].tier)).toBeGreaterThanOrEqual(order.indexOf(scored[k - 1].tier));
      expect(scored[k].score).toBeLessThanOrEqual(scored[k - 1].score);
    }
    const total = data.rows.reduce((s, r) => s + r.share, 0);
    expect(total).toBeGreaterThan(0.95);
    expect(total).toBeLessThan(1.01);
    for (const r of data.rows) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      if (r.best) expect(championIds).toHaveProperty(r.best);
    }
  });

  it("puts the big Weapons near the top of the played list", () => {
    // Mage and fighter staples are the most made Weapons (AramHex 16.23: Shadowflame, Endless Hunger, Heartsteel).
    const byGames = [...data.rows].sort((a, b) => b.games - a.games).slice(0, 10).map((r) => r.name);
    expect(byGames.filter((n) => ["Shadowflame", "Endless Hunger", "Heartsteel", "Luden's Echo", "Blade of The Ruined King"].includes(n)).length).toBeGreaterThanOrEqual(3);
  });
});

describe("Weapon of Destiny by champion", () => {
  const rows = destinyByChampion();
  const pages = new Map(itemPages().map((i) => [i.id, i]));

  it("gives most champions a Legendary item with a page, and a different next best", () => {
    expect(rows.length).toBeGreaterThan(150);
    for (const r of rows) {
      expect(championIds, r.champion).toHaveProperty(r.champion);
      expect(pages.get(r.item.id)?.tier, r.champion).toBe("legendary");
      if (r.next) expect(r.next.id, r.champion).not.toBe(r.item.id);
      expect(r.score, r.champion).toBeGreaterThanOrEqual(0);
      expect(r.score, r.champion).toBeLessThanOrEqual(100);
      expect(r.games, r.champion).toBeGreaterThan(0);
    }
  });
});
