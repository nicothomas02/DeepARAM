import "server-only";
import augmentNames from "@/data/augment-names.json";
import championIds from "@/data/champion-ids.json";
import { itemPages } from "./item-pages";
import { pentakill, upgradesFile, type PentakillRow } from "./pentakill";

// The "Best upgrades" panel on a champion page: its best set of 4 augments (real estimated lifts plus simulated
// synergy), the item to make its Weapon of Destiny and its Pentakill picks, all from
// data/estimates/champion_upgrades.py.

export type UpgradesChampion = {
  weapon_of_destiny: { takedowns: number; options: { item: number; sim_gain: number }[] } | null;
  augments: { best: { augments: number[]; score: number; synergy: number; simulated?: boolean } } | null;
};
type Data = { champions: Record<string, UpgradesChampion> };

export type ChampionUpgrades = {
  /** Best 4 augments, their estimated win rate boost together and the synergy part of it (fractions); simulated when
   * one of them has no real games yet (live or on this champion), so only the simulator put it in the set. */
  augments: { ids: number[]; boost: number; synergy: number; simulated: boolean } | null;
  /** The item to make the Weapon of Destiny, and how much stronger its upgrades make the champion (fraction). */
  destiny: { id: number; slug: string; name: string; icon: string; gain: number; takedowns: number } | null;
  pentakill: PentakillRow | null;
};

type ItemPageLike = { id: number; slug: string; name: string; icon?: string };

const NAMES = augmentNames as Record<string, string>;
// A number the file left out, null or NaN shows as nothing gained, never as NaN.
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

let pages: Map<number, ItemPageLike> | null = null;

export function championUpgrades(alias: string): ChampionUpgrades | null {
  const key = (championIds as Record<string, number>)[alias];
  if (key === undefined) return null;
  pages ??= new Map(itemPages().map((i) => [i.id, i]));
  return upgradesFrom(upgradesFile<Data>()?.champions?.[String(key)], pages, pentakill().find((r) => r.champion === alias) ?? null);
}

/** The panel's data for one champion's entry in the file, or null when there's nothing to show. */
export function upgradesFrom(c: UpgradesChampion | undefined, pages: Map<number, ItemPageLike>, penta: PentakillRow | null): ChampionUpgrades | null {
  if (!c && !penta) return null;
  const best = c?.augments?.best;
  const ids = Array.isArray(best?.augments) ? best.augments : [];
  // A set is 4 different augments the site knows: one that left the pool can't be picked, so the set isn't shown.
  const set = ids.length === 4 && new Set(ids).size === 4 && ids.every((id) => NAMES[String(id)]);
  const top = c?.weapon_of_destiny?.options?.[0];
  const page = top ? pages.get(top.item) : undefined;
  const out: ChampionUpgrades = {
    augments: best && set ? { ids, boost: num(best.score) / 100, synergy: num(best.synergy) / 100, simulated: best.simulated === true } : null,
    destiny:
      top && page
        ? { id: page.id, slug: page.slug, name: page.name, icon: page.icon ?? "", gain: num(top.sim_gain) / 100, takedowns: num(c?.weapon_of_destiny?.takedowns) }
        : null,
    pentakill: penta,
  };
  return out.augments || out.destiny || out.pentakill ? out : null;
}
