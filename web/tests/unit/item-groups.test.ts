import { describe, expect, it } from "vitest";
import { inMayhem, itemClasses, itemTier } from "@/lib/items";
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
});
