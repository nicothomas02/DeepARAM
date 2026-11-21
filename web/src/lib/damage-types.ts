import "server-only";
import championIds from "@/data/champion-ids.json";
import { ddVersion } from "./dd-swap";
import { readRepoJson } from "./repo-data";

// What kind of damage each champion deals and what each finished item gives, for the desktop app's enemy-aware
// damage line (apps/desktop companion.html): the enemy team's mix of physical and magic damage, from their champions
// and, as the game goes on, from the items they've bought. Data Dragon only.

export type DamageTypes = {
  /** alias -> the share of the champion's damage that's magic, 0 to 1 (Data Dragon's attack and magic ratings) */
  champions: Record<string, number>;
  /** item id (last four digits, so Mayhem's copies match) -> what it gives: "ad", "ap", "armor", "mr", "crit", "as",
   *  "haste", "armorpen", "magicpen" */
  items: Record<string, string[]>;
  /** boots ids (last four digits), to tell whether the player has bought boots yet */
  boots: number[];
  /** item id (last four digits) -> [name, total cost, the components it's built from (ids)], for "buy now" */
  recipes: Record<string, [string, number, number[]]>;
};

type DdChampion = { info: { attack: number; magic: number } };
type DdItem = {
  name?: string;
  tags?: string[];
  gold?: { total: number; purchasable?: boolean };
  into?: string[];
  from?: string[];
  maps?: Record<string, boolean>;
};

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
  const out: DamageTypes = { champions: {}, items: {}, boots: [], recipes: {} };
  for (const alias of Object.keys(championIds)) {
    const c = byLower.get(alias.toLowerCase());
    if (!c) continue;
    const { attack, magic } = c.info;
    out.champions[alias] =
      attack + magic ? Math.round((magic / (attack + magic)) * 100) / 100 : 0.5;
  }
  const short = (id: string | number) => Number(id) % 10000;
  for (const [id, it] of Object.entries(items)) {
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
    if (kinds.length) out.items[String(Number(id) % 10000)] = kinds;
  }
  return out;
}
