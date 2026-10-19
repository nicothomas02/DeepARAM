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
// The champion with the bigger share of its team's damage is listed first.

type Partner = { champion_id: number; win_rate: number; pick_rate: number };
type Champs = { champions: { champion_id: number; win_rate: number; pick_rate: number; avg_damage_ratio?: number; best_partners?: Partner[] }[] };
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
  // How often a champion has another as a teammate: its own listing, else the other's turned around by
  // the two champions' pick rates (a pair's games over the first champion's games).
  const listed = new Map(champs.flatMap((c) => (c.best_partners ?? []).map((p) => [`${c.champion_id}-${p.champion_id}`, p.pick_rate] as const)));
  const withMate = (a: number, b: number) =>
    listed.get(`${a}-${b}`) ?? (listed.get(`${b}-${a}`) ?? 0) * ((solo.get(b)?.pick_rate ?? 0) / (solo.get(a)?.pick_rate || 1));
  const damage = (id: number) => solo.get(id)?.avg_damage_ratio ?? 0;
  const seen = new Set<string>();
  const out: DuoRow[] = [];
  for (const c of champs) {
    for (const p of c.best_partners ?? []) {
      const other = solo.get(p.champion_id);
      const key = [c.champion_id, p.champion_id].sort((m, n) => m - n).join("-");
      if (!other || !ALIAS[c.champion_id] || !ALIAS[p.champion_id] || seen.has(key)) continue;
      seen.add(key);
      const [first, second] = damage(p.champion_id) > damage(c.champion_id) ? [p.champion_id, c.champion_id] : [c.champion_id, p.champion_id];
      const [x, y] = [ALIAS[first], ALIAS[second]];
      out.push({
        a: x,
        b: y,
        pair: `${x} ${y}`,
        delta: synergy(p.win_rate, c.win_rate, other.win_rate),
        pick_rate: withMate(first, second),
        roles: [roles.get(first), roles.get(second)].filter(Boolean).join(" + "),
      });
    }
  }
  cache = out;
  return out;
}
