import "server-only";
import championIds from "@/data/champion-ids.json";
import { readRepoJson } from "./repo-data";
import { synergy } from "./synergy";

// The Duos tab: every pair of teammates the live stats list. Each champion lists its 50 most played-with
// teammates (data/cn/champions.json best_partners), so the pairs cover strong and weak champions alike,
// about 7,000 in all. The champion and pair win rates come from the same snapshot, so they compare fairly.
//
// delta: the pair's synergy, how much more it wins than the two champions' own win rates predict
// (lib/synergy.ts); the pair's raw win rate isn't shown, it mostly echoes the two champions' own. pick_rate: how often the first champion has the second as a teammate.

type Partner = { champion_id: number; win_rate: number; pick_rate: number };
type Champs = { champions: { champion_id: number; win_rate: number; pick_rate: number; best_partners?: Partner[] }[] };
type Duos = { duos: { champion_ids?: number[]; roles?: string[] }[] };

const ALIAS = Object.fromEntries(Object.entries(championIds as Record<string, number>).map(([a, id]) => [id, a]));

export const hasDuos = () => Boolean(readRepoJson<Champs>("data/cn/champions.json")?.champions.some((c) => c.best_partners?.length));

export type DuoRow = { a: string; b: string; pair: string; delta: number; pick_rate: number; roles: string };

let cache: DuoRow[] | null = null;
export function duoRows(): DuoRow[] {
  if (cache) return cache;
  const champs = readRepoJson<Champs>("data/cn/champions.json")?.champions ?? [];
  const solo = new Map(champs.map((c) => [c.champion_id, c]));
  // Roles per champion, as the duo list writes them ("mage,support" becomes "mage/support").
  const roles = new Map<number, string>();
  for (const d of readRepoJson<Duos>("data/cn/duos.json")?.duos ?? [])
    (d.champion_ids ?? []).forEach((id, i) => d.roles?.[i] && roles.set(id, d.roles[i].replace(/,/g, "/")));
  const seen = new Set<string>();
  const out: DuoRow[] = [];
  for (const c of champs) {
    for (const p of c.best_partners ?? []) {
      const other = solo.get(p.champion_id);
      const [x, y] = [ALIAS[c.champion_id], ALIAS[p.champion_id]];
      const key = [c.champion_id, p.champion_id].sort((m, n) => m - n).join("-");
      if (!other || !x || !y || seen.has(key)) continue;
      seen.add(key);
      out.push({
        a: x,
        b: y,
        pair: `${x} ${y}`,
        delta: synergy(p.win_rate, c.win_rate, other.win_rate),
        pick_rate: p.pick_rate,
        roles: [roles.get(c.champion_id), roles.get(p.champion_id)].filter(Boolean).join(" + "),
      });
    }
  }
  cache = out;
  return out;
}
