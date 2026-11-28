import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { localAsset } from "./assets";
import { official } from "./dd-swap";
import { readRepoJson } from "./repo-data";
import itemGroups from "@/data/item-groups.json";
import { situationFor, type Situation } from "./situations";

// Item names and icons from the client's item list, mirrored in public/assets/.
const GAME_DATA = "plugins/rcp-be-lol-game-data/global/default";

export type Item = { id: number; name: string; icon?: string };

let cache: Map<number, Item> | null = null;
export function items(): Map<number, Item> {
  if (cache) return cache;
  const file = join(process.cwd(), "public", "assets", "cd", "latest", GAME_DATA, "v1", "items.json");
  const list = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { id: number; name: string; iconPath?: string }[]) : [];
  cache = new Map(
    list.map((i) => [
      i.id,
      {
        id: i.id,
        name: i.name,
        icon: i.iconPath ? official(localAsset(`https://raw.communitydragon.org/latest/${GAME_DATA}/${i.iconPath.replace(/^\/lol-game-data\/assets\//i, "")}`)) : undefined,
      },
    ]),
  );
  return cache;
}

export const item = (id: number) => items().get(id);

/** Items only an augment hands out as a quest reward; they're left out of build lists (guide/augment_rules.json). */
let rewards: Set<number> | null = null;
export function rewardItems(): Set<number> {
  rewards ??= new Set(
    (readRepoJson<{ grantedItems?: { id: number; how: string }[] }>("guide/augment_rules.json")?.grantedItems ?? [])
      .filter((g) => g.how === "reward")
      .map((g) => g.id),
  );
  return rewards;
}

export type ItemTier = "legendary" | "boots" | "epic" | "basic" | "starter" | "consumable" | "reward";
export const ITEM_TIERS: ItemTier[] = ["legendary", "boots", "starter", "epic", "basic", "consumable", "reward"];

// The game's own grouping of each item (scripts/fetch_item_groups.py): e = epicness (the shop's rarity),
// g = named item groups, c = the shop's class filters, m = sold in ARAM Mayhem's shop.
type Groups = { e?: number; g?: string[]; c?: string[]; m?: 1 };
const GROUPS = itemGroups as Record<string, Groups>;
const EPICNESS: Record<number, ItemTier> = { 1: "starter", 4: "epic", 5: "legendary", 7: "consumable", 0: "consumable" };

/** Whether ARAM Mayhem's shop sells the item (Doran's items, for one, aren't sold there). Items the
 *  game data doesn't cover count as sold; the "Stat Bonus" placeholder (epicness 8) doesn't. */
export const inMayhem = (id: number): boolean => !GROUPS[id] || (GROUPS[id].m === 1 && GROUPS[id].e !== 8);

/** The in-game shop's class filters for an item (fighter, marksman, assassin, mage, tank, support). */
export const itemClasses = (id: number): string[] => GROUPS[id]?.c ?? [];

/** An item's shop tier: the game's own rarity and item groups, or for items missing there, its recipe:
 *  boots, finished (legendary), a component of one (epic or basic), or a cheap standalone starter. */
type Recipe = { id: number; from: number[]; to: number[]; categories: string[]; priceTotal: number; specialRecipe: number; description?: string };
let recipes: Map<number, Recipe> | null = null;
export function itemTier(id: number): ItemTier {
  if (rewardItems().has(id)) return "reward";
  const game = GROUPS[id];
  if (game) {
    if (game.g?.includes("Boots")) return "boots";
    if (game.g?.includes("Consumable")) return "consumable";
    return game.e === undefined ? "basic" : (EPICNESS[game.e] ?? "epic");
  }
  return recipeTier(id);
}

function recipeMap(): Map<number, Recipe> {
  if (!recipes) {
    const file = join(process.cwd(), "public", "assets", "cd", "latest", GAME_DATA, "v1", "items.json");
    recipes = new Map((existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Recipe[]) : []).map((r) => [r.id, r]));
  }
  return recipes;
}

/** An item's recipe parts and total price, from the client's item list. An item whose plain entry lists no parts
 *  (Rite of Ruin) takes them from its mode variant (123430, 223430), which the shop uses. */
export const itemRecipe = (id: number): { from: number[]; price: number } | undefined => {
  const r = recipeMap().get(id);
  if (!r) return undefined;
  const v = r.from?.length ? r : [120000 + id, 220000 + id].map((x) => recipeMap().get(x)).find((x) => x?.from?.length);
  return { from: (v?.from ?? []).map((x) => (x >= 100000 ? x % 10000 : x)), price: r.priceTotal ?? v?.priceTotal ?? 0 };
};

/** Every component an item is built from, all the way down (Infinity Edge: B. F. Sword, Pickaxe, Cloak...). */
export function itemParts(id: number): number[] {
  const out = new Set<number>();
  const walk = (i: number, depth: number) => {
    if (depth > 4) return;
    for (const p of itemRecipe(i)?.from ?? []) {
      out.add(p);
      walk(p, depth + 1);
    }
  };
  walk(id, 0);
  return [...out];
}

/** When to buy this item, from its shop text (lib/situations.ts), or null for a general item. */
/** An item's shop text (HTML), or "" when the game data doesn't have it. */
export const itemDescription = (id: number): string => recipeMap().get(id)?.description ?? "";

export const itemSituation = (id: number): Situation | null => {
  const r = recipeMap().get(id);
  return r ? situationFor(r.description ?? "", r.categories ?? []) : null;
};

let transforms: Map<number, number> | null = null;
/** The item this one turns into mid-game, at the end of the chain (Archangel's Staff into Seraph's Embrace,
 *  Spellthief's Edge through Frostfang into Shard of True Ice), or undefined if it doesn't transform. */
export function transformsInto(id: number): number | undefined {
  if (!transforms) {
    const next = new Map<number, number>();
    for (const r of recipeMap().values()) if (r.specialRecipe && r.specialRecipe !== r.id) next.set(r.specialRecipe, r.id);
    transforms = new Map();
    for (const from of next.keys()) {
      let to = next.get(from)!;
      for (let hops = 0; next.has(to) && hops < 5; hops++) to = next.get(to)!;
      transforms.set(from, to);
    }
  }
  return transforms.get(id);
}

/** Whether an item gets a DeepScore. Components and items that transform are mostly seen in an inventory when
 *  a game ended before they were finished, so their win rates read low; they're shown without a score. */
export const ranked = (id: number): boolean => transformsInto(id) === undefined && !["epic", "basic"].includes(itemTier(id));

function recipeTier(id: number): ItemTier {
  const r = recipeMap().get(id);
  if (!r) return "legendary";
  if (r.categories?.includes("Boots")) return "boots";
  if (r.categories?.includes("Consumable")) return "consumable";
  // Transformations (Whispering Circlet into Diadem of Songs) aren't upgrades.
  const upgrades = (r.to ?? []).filter((t) => recipeMap().get(t)?.specialRecipe !== id);
  if (upgrades.length) return r.from?.length ? "epic" : "basic";
  if (!r.from?.length && r.priceTotal < 1000) return "starter";
  return "legendary";
}

/** An item's roles from the simulator's item data (simulator/data/items.json: onhit, ap, tank ...), by its base id
 *  (the mode's copies share them). Item metadata only; no simulated numbers. */
let roles: Map<number, string[]> | null = null;
export function itemRoles(id: number): string[] {
  roles ??= new Map(
    Object.values(readRepoJson<{ items: Record<string, { id?: number; roles?: string[] }> }>("simulator/data/items.json")?.items ?? {}).flatMap((v) =>
      v.id ? [[v.id, v.roles ?? []] as [number, string[]]] : [],
    ),
  );
  return roles.get(id >= 100000 ? id % 10000 : id) ?? [];
}
