import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { localAsset } from "./assets";
import { official } from "./dd-swap";
import { readRepoJson } from "./repo-data";

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

export type ItemTier = "legendary" | "boots" | "epic" | "basic" | "starter";
export const ITEM_TIERS: ItemTier[] = ["legendary", "boots", "epic", "basic", "starter"];

/** An item's shop tier from its recipe: boots, finished (legendary), a component of one (epic or basic), or a cheap standalone starter. */
type Recipe = { id: number; from: number[]; to: number[]; categories: string[]; priceTotal: number; specialRecipe: number };
let recipes: Map<number, Recipe> | null = null;
export function itemTier(id: number): ItemTier {
  if (!recipes) {
    const file = join(process.cwd(), "public", "assets", "cd", "latest", GAME_DATA, "v1", "items.json");
    recipes = new Map((existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Recipe[]) : []).map((r) => [r.id, r]));
  }
  const r = recipes.get(id);
  if (!r) return "legendary";
  if (r.categories?.includes("Boots")) return "boots";
  // Transformations (Whispering Circlet into Diadem of Songs) aren't upgrades.
  const upgrades = (r.to ?? []).filter((t) => recipes!.get(t)?.specialRecipe !== id);
  if (upgrades.length) return r.from?.length ? "epic" : "basic";
  if (!r.from?.length && r.priceTotal < 1000) return "starter";
  return "legendary";
}
