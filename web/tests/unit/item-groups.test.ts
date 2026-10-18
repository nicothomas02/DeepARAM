import { describe, expect, it } from "vitest";
import { itemClasses, itemTier } from "@/lib/items";
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
});
