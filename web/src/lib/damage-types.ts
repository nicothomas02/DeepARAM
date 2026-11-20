import "server-only";
import championIds from "@/data/champion-ids.json";
import { ddVersion } from "./dd-swap";
import { readRepoJson } from "./repo-data";

// What kind of damage each champion deals and what each finished item gives, for the desktop app's enemy-aware
// item tip (apps/desktop companion.html): the enemy team's mix of physical and magic damage, from their champions
// and, as the game goes on, from the items they've bought. Data Dragon only.

export type DamageTypes = {
  /** alias -> the share of the champion's damage that's magic, 0 to 1 (Data Dragon's attack and magic ratings) */
  champions: Record<string, number>;
  /** item id (last four digits, so Mayhem's copies match) -> what it gives: "ad", "ap", "armor", "mr" */
  items: Record<string, string[]>;
  /** boots ids (last four digits), to tell whether the player has bought boots yet */
  boots: number[];
};

type DdChampion = { info: { attack: number; magic: number } };
type DdItem = { tags?: string[]; gold?: { total: number }; into?: string[] };

const KIND: [string, string[]][] = [
  ["ad", ["Damage", "CriticalStrike", "AttackSpeed", "ArmorPenetration"]],
  ["ap", ["SpellDamage", "MagicPenetration"]],
  ["armor", ["Armor"]],
  ["mr", ["SpellBlock"]],
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
  const out: DamageTypes = { champions: {}, items: {}, boots: [] };
  for (const alias of Object.keys(championIds)) {
    const c = byLower.get(alias.toLowerCase());
    if (!c) continue;
    const { attack, magic } = c.info;
    out.champions[alias] =
      attack + magic ? Math.round((magic / (attack + magic)) * 100) / 100 : 0.5;
  }
  for (const [id, it] of Object.entries(items)) {
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
