import "server-only";
import championIds from "@/data/champion-ids.json";
import { itemPages } from "./item-pages";
import { pentakill, type PentakillRow } from "./pentakill";
import { readRepoJson } from "./repo-data";

// The "Best upgrades" panel on a champion page: its best set of 4 augments (real estimated lifts plus simulated
// synergy), the item to make its Weapon of Destiny and its Pentakill picks, all from
// data/estimates/champion_upgrades.py.

type Data = {
  champions: Record<
    string,
    {
      weapon_of_destiny: { takedowns: number; options: { item: number; sim_gain: number }[] } | null;
      augments: { best: { augments: number[]; score: number; synergy: number; simulated?: boolean } } | null;
    }
  >;
};

export type ChampionUpgrades = {
  /** Best 4 augments, their estimated win rate boost together and the synergy part of it (fractions); simulated when
   * one of them has no real games yet (live or on this champion), so only the simulator put it in the set. */
  augments: { ids: number[]; boost: number; synergy: number; simulated: boolean } | null;
  /** The item to make the Weapon of Destiny, and how much stronger its upgrades make the champion (fraction). */
  destiny: { id: number; slug: string; name: string; icon: string; gain: number; takedowns: number } | null;
  pentakill: PentakillRow | null;
};

export function championUpgrades(alias: string): ChampionUpgrades | null {
  const key = (championIds as Record<string, number>)[alias];
  const c = readRepoJson<Data>("data/estimates/champion_upgrades.json")?.champions[String(key)];
  if (!c) return null;
  const best = c.augments?.best;
  const top = c.weapon_of_destiny?.options[0];
  const page = top ? itemPages().find((i) => i.id === top.item) : undefined;
  const out: ChampionUpgrades = {
    augments:
      best?.augments.length === 4
        ? { ids: best.augments, boost: best.score / 100, synergy: best.synergy / 100, simulated: !!best.simulated }
        : null,
    destiny:
      top && page
        ? { id: page.id, slug: page.slug, name: page.name, icon: page.icon ?? "", gain: top.sim_gain / 100, takedowns: c.weapon_of_destiny!.takedowns }
        : null,
    pentakill: pentakill().find((r) => r.champion === alias) ?? null,
  };
  return out.augments || out.destiny || out.pentakill ? out : null;
}
