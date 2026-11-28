import "server-only";
import championIds from "@/data/champion-ids.json";
import { ddVersion } from "./dd-swap";
import { readRepoJson } from "./repo-data";
import limits from "@/data/item-limits.json";
import substitutes from "@/data/item-substitutes.json";
import { UNENFORCED } from "./item-limits";

// What kind of damage each champion deals and what each finished item gives, for the desktop app's enemy-aware
// damage line (apps/desktop companion.html): the enemy team's mix of physical and magic damage, from their champions
// and, as the game goes on, from the items they've bought. Item stats from Data Dragon; champion splits measured where
// there are enough games (below), else Data Dragon.

export type DamageTypes = {
  /** alias -> the share of the champion's damage that's magic, 0 to 1 (Data Dragon's attack and magic ratings) */
  champions: Record<string, number>;
  /** item id (last four digits, so Mayhem's copies match) -> what it gives: "ad", "ap", "armor", "mr", "crit", "as",
   *  "haste", "armorpen", "magicpen", "ult" (works through the ultimate) */
  items: Record<string, string[]>;
  /** boots ids (last four digits), to tell whether the player has bought boots yet */
  boots: number[];
  /** item id (last four digits) -> [name, total cost, the components it's built from (ids)], for "buy now" */
  recipes: Record<string, [string, number, number[]]>;
  /** The game's "own only one" groups (item ids, last four digits) the build engine enforces (lib/item-limits.ts). */
  limits: number[][];
  /** Role substitutes, rarely built together: a swap replaces its substitute (data/item-substitutes.json). */
  substitutes: number[][];
};

type DdChampion = { info: { attack: number; magic: number } };
type DdItem = {
  name?: string;
  tags?: string[];
  gold?: { total: number; purchasable?: boolean };
  into?: string[];
  from?: string[];
  maps?: Record<string, boolean>;
  description?: string;
};

/** Games a champion needs in the measured split before it replaces Data Dragon's ratings. */
export const MEASURED_GAMES = 30;

const KIND: [string, string[]][] = [
  ["ad", ["Damage", "CriticalStrike", "AttackSpeed", "ArmorPenetration"]],
  ["ap", ["SpellDamage", "MagicPenetration"]],
  ["armor", ["Armor"]],
  ["mr", ["SpellBlock"]],
  ["crit", ["CriticalStrike"]],
  ["as", ["AttackSpeed"]],
  ["haste", ["AbilityHaste", "CooldownReduction"]],
  ["armorpen", ["ArmorPenetration"]],
  ["magicpen", ["MagicPenetration"]],
];

export function damageTypes(): DamageTypes {
  const dir = `web/public/assets/dd/${ddVersion}/data/en_US`;
  const champs =
    readRepoJson<{ data: Record<string, DdChampion> }>(`${dir}/champion.json`)
      ?.data ?? {};
  const items =
    readRepoJson<{ data: Record<string, DdItem> }>(`${dir}/item.json`)?.data ??
    {};
  const byLower = new Map(
    Object.entries(champs).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const out: DamageTypes = {
    champions: {},
    items: {},
    boots: [],
    recipes: {},
    limits: (limits as { group: string; items: number[] }[])
      .filter((g) => !UNENFORCED.has(g.group))
      .map((g) => [...new Set(g.items.map((i) => (i >= 100000 ? i % 10000 : i)))]),
    substitutes: substitutes.pairs,
  };
  // The measured split (data/estimates/damage_types.json: physical and magic damage to champions in archived Mayhem
  // games, all ten players, the site's own "Damage type" numbers) where a champion has MEASURED_GAMES games; else Data
  // Dragon's 1-10 attack and magic ratings. Those ratings misread 20 of 163 measured champions: Qiyana rated all
  // magic (measured 12% magic), Seraphine, Vex and Twisted Fate an even split (87-96% magic), Gwen mostly physical
  // (85% magic). The engine reads this for the champion's own damage type (breakpoints, elixirs, converters).
  const measured =
    readRepoJson<{ champions: Record<string, { physical: number; magic: number; games: number }> }>(
      "data/estimates/damage_types.json",
    )?.champions ?? {};
  for (const [alias, cid] of Object.entries(championIds as Record<string, number>)) {
    const m = measured[String(cid)];
    if (m && m.games >= MEASURED_GAMES && m.physical + m.magic > 0) {
      out.champions[alias] = Math.round((m.magic / (m.physical + m.magic)) * 100) / 100;
      continue;
    }
    const c = byLower.get(alias.toLowerCase());
    if (!c) continue;
    const { attack, magic } = c.info;
    out.champions[alias] =
      attack + magic ? Math.round((magic / (attack + magic)) * 100) / 100 : 0.5;
  }
  const short = (id: string | number) => Number(id) % 10000;
  // Ids share their last four digits across modes, and not always with the same item: Arena's 77xxxx copies reuse
  // them (773084 is Innervating Locket, not Heartsteel; 773109 Madred's Bloodrazor, not Knight's Vow). The base id
  // (else the lowest copy) names the item, and a copy with another name never fills its entry (2026-11-28 replay of
  // every archived game: 36 items carried another item's stats, so owning Heartsteel read as AD and re-planned Akali's
  // build to Enchanter).
  const named = new Map<number, string | undefined>();
  for (const [id, it] of Object.entries(items).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    if (!named.has(short(id))) named.set(short(id), it.name);
    else if (named.get(short(id)) !== it.name) continue;
    // Every item the ARAM shop sells, with what it's built from, so the app can say what your gold buys now.
    if (
      it.maps?.["12"] &&
      it.gold?.purchasable &&
      it.gold.total > 0 &&
      !out.recipes[short(id)]
    )
      out.recipes[short(id)] = [
        it.name ?? "",
        it.gold.total,
        (it.from ?? []).map(short),
      ];
    // Finished items and boots only: components say little about what a champion is building.
    const boots = it.tags?.includes("Boots") ?? false;
    if (boots && !out.boots.includes(Number(id) % 10000))
      out.boots.push(Number(id) % 10000);
    if (!boots && ((it.gold?.total ?? 0) < 2000 || it.into?.length)) continue;
    const kinds = KIND.filter(([, tags]) =>
      tags.some((t) => it.tags?.includes(t)),
    ).map(([k]) => k);
    // "ult": the item's passive or haste works through the ultimate (shop text names it: Axiom Arc, Malignance,
    // Experimental Hexplate, Zeke's, Fiendhunter Bolts), so Back To Basics, which seals the ultimate, empties it.
    if (/Ultimate/.test(it.description ?? "")) kinds.push("ult");
    if (kinds.length && !out.items[String(short(id))]) out.items[String(short(id))] = kinds;
  }
  return out;
}
