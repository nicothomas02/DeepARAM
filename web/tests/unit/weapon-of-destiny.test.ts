// Weapon of Destiny tab: every ranked item is a Legendary item with a page, its per-takedown stats add up to the
// augment's 200 gold, and the tiers follow the predicted score, stat value (Nico 2026-10-27).
import { describe, expect, it } from "vitest";
import championIds from "@/data/champion-ids.json";
import { itemPages } from "@/lib/item-pages";
import { destinyByChampion, weaponOfDestiny } from "@/lib/weapon-of-destiny";

describe("Weapon of Destiny ranking", () => {
  const data = weaponOfDestiny()!;
  const pages = new Map(itemPages().map((i) => [i.id, i]));

  it("ranks most Legendary items", () => {
    expect(data.gold).toBe(200);
    expect(data.rows.length).toBeGreaterThan(80);
    // Items without a page (Mayhem's Hubris) are Legendary items only seen in core builds: some champion buys them first.
    for (const r of data.rows) if (r.slug) expect(pages.get(r.id)?.tier, r.name).toBe("legendary");
    else expect(r.share, r.name).toBeGreaterThan(0);
  });

  it("gives each item only upgradeable stats, shared equally", () => {
    // One takedown's worth of a single stat, from the augment's values (1,000 gold buys 30 AD, 375 Health ...).
    const alone: Record<string, number> = { ad: 6, ap: 10, hp: 75, armor: 10, mr: 10, ah: 4, crit: 0.05, as: 0.08, lethality: 7, lifesteal: 0.05 };
    for (const r of data.rows) {
      const keys = Object.keys(r.perTakedown);
      expect(keys.length, r.name).toBeGreaterThan(0);
      for (const k of keys) if (k in alone) expect(r.perTakedown[k], `${r.name} ${k}`).toBeCloseTo(alone[k] / keys.length, 4);
    }
  });

  it("tiers a higher stat value at least as high, with shares that add up", () => {
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

  it("ranks rare, damage-multiplying stats first and spreads value thin over many stats", () => {
    // Critical Strike Damage and Armor or Magic Penetration % each come from one or two Legendary items.
    const top = [...data.rows].sort((a, b) => b.rank - a.rank).slice(0, 4).map((r) => r.name);
    for (const name of ["Infinity Edge", "Void Staff", "Lord Dominik's Regards"]) expect(top).toContain(name);
    const by = new Map(data.rows.map((r) => [r.name, r]));
    // Infinity Edge (crit damage) is worth more per takedown than Ravenous Hydra's spread of common stats, and
    // Phantom Dancer's rare Move Speed % beats Trinity Force's AD, Health and Haste.
    expect(by.get("Infinity Edge")!.score).toBeGreaterThan(by.get("Ravenous Hydra")!.score);
    expect(by.get("Phantom Dancer")!.score).toBeGreaterThan(by.get("Trinity Force")!.score);
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
      expect(r.power, r.champion).toBeGreaterThan(0);
    }
  });
});
