import { describe, expect, it } from "vitest";
import { inMayhem, itemClasses, itemTier, ranked, transformsInto } from "@/lib/items";
import { itemPages } from "@/lib/item-pages";

describe("item groups", () => {
  it("follows the game's own rarity and item groups", () => {
    expect(itemTier(3008)).toBe("boots"); // Gluttonous Greaves
    expect(itemTier(1001)).toBe("boots"); // Boots
    expect(itemTier(3070)).toBe("starter"); // Tear of the Goddess
    expect(itemTier(1055)).toBe("starter"); // Doran's Blade
    expect(itemTier(3044)).toBe("epic"); // Phage
    expect(itemTier(1038)).toBe("basic"); // B. F. Sword
    expect(itemTier(3031)).toBe("legendary"); // Infinity Edge
    expect(itemTier(2003)).toBe("consumable"); // Health Potion
    expect(itemTier(2138)).toBe("consumable"); // Elixir of Iron
  });

  it("tags items with the shop's class filters", () => {
    expect(itemClasses(3089)).toEqual(["mage"]); // Rabadon's Deathcap
    expect(itemClasses(3075)).toEqual(["tank", "support"]); // Thornmail
    const ie = itemPages().find((i) => i.id === 3031);
    expect(ie?.tags).toContain("marksman");
    expect(ie?.tags).toContain("crit");
  });

  it("lists only what ARAM Mayhem's shop sells", () => {
    expect(inMayhem(1055)).toBe(false); // Doran's Blade
    expect(inMayhem(6032)).toBe(false); // Stat Bonus placeholder
    const ids = new Set(itemPages().map((i) => i.id));
    expect(ids.has(1055)).toBe(false);
    expect(ids.has(3008)).toBe(true);
  });

  it("counts items bought in combinations, so rarely-single items still have data", () => {
    const gg = itemPages().find((i) => i.id === 3008); // Gluttonous Greaves
    expect(gg?.builders.length).toBeGreaterThan(0);
  });

  it("leaves components and items that transform out of the rankings", () => {
    expect(transformsInto(3003)).toBe(3040); // Archangel's Staff -> Seraph's Embrace
    expect(transformsInto(2526)).toBe(2530); // Whispering Circlet -> Diadem of Songs
    expect(transformsInto(3850)).toBe(3853); // Spellthief's Edge -> Frostfang -> Shard of True Ice
    expect(transformsInto(3031)).toBeUndefined(); // Infinity Edge
    expect(ranked(3003)).toBe(false);
    expect(ranked(3044)).toBe(false); // Phage
    expect(ranked(1038)).toBe(false); // B. F. Sword
    expect(ranked(3031)).toBe(true);
    const pages = itemPages();
    for (const id of [3003, 2526, 3044]) {
      const p = pages.find((i) => i.id === id);
      if (p) expect(p.deepScore).toBeNull();
    }
    expect(pages.find((i) => i.id === 3031)?.deepScore).not.toBeNull();
  });

  it("shows each item's recipe, counting repeated components once with how many", () => {
    const trinity = itemPages().find((i) => i.name === "Trinity Force")!;
    expect(trinity.from.map((p) => p.name)).toEqual(expect.arrayContaining(["Sheen", "Phage"]));
    expect(trinity.from.every((p) => p.count >= 1 && p.cost > 0)).toBe(true);
    const sheen = itemPages().find((i) => i.name === "Sheen")!;
    expect(sheen.into.map((p) => p.name)).toContain("Trinity Force");
    expect(sheen.into.every((p) => p.slug)).toBe(true);
  });
});
