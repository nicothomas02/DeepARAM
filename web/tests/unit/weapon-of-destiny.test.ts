// Weapon of Destiny tab: every ranked item is a Legendary item with a page, its per-takedown stats add up to the
// augment's 200 gold, and the tiers follow the ranking value.
import { describe, expect, it } from "vitest";
import championIds from "@/data/champion-ids.json";
import { itemPages } from "@/lib/item-pages";
import { weaponOfDestiny } from "@/lib/weapon-of-destiny";

describe("Weapon of Destiny ranking", () => {
  const data = weaponOfDestiny()!;
  const pages = new Map(itemPages().map((i) => [i.id, i]));

  it("ranks most Legendary items", () => {
    expect(data.gold).toBe(200);
    expect(data.rows.length).toBeGreaterThan(80);
    for (const r of data.rows) expect(pages.get(r.id)?.tier, r.name).toBe("legendary");
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

  it("tiers a higher value at least as high, with shares that add up", () => {
    const order = ["S", "A", "B", "C", "D"];
    const sorted = [...data.rows].sort((a, b) => b.value - a.value);
    for (let k = 1; k < sorted.length; k++) expect(order.indexOf(sorted[k].tier)).toBeGreaterThanOrEqual(order.indexOf(sorted[k - 1].tier));
    const total = data.rows.reduce((s, r) => s + r.share, 0);
    expect(total).toBeGreaterThan(0.95);
    expect(total).toBeLessThan(1.01);
    for (const r of data.rows) {
      expect(r.rare).toBeGreaterThanOrEqual(0);
      expect(r.rare).toBeLessThanOrEqual(100);
      if (r.best) expect(championIds).toHaveProperty(r.best);
    }
    // Infinity Edge carries Critical Strike Damage, the rarest stat; Warmog's only Health.
    const rare = (name: string) => data.rows.find((r) => r.name === name)!.rare;
    expect(rare("Infinity Edge")).toBeGreaterThan(rare("Warmog's Armor"));
  });
});
