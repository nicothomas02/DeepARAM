import "server-only";
import championIds from "@/data/champion-ids.json";
import { windowJson } from "./champion-page";
import { readRepoJson } from "./repo-data";

// Pentakill tab (/tier-list?tab=pentakill): which ability each champion should Empower in a Pentakill game, one
// basic ability at the start and a second one (the ultimate allowed) at level 18. data/estimates/champion_upgrades.py
// picks them in the Simulator on the champion's most popular build and turns the gain into estimated win rate points.

type Pick = { score: number; early: number; mid: number; late: number };
type Data = {
  patch: string;
  champions: Record<
    string,
    {
      key: string;
      pentakill: {
        start: string;
        level18: string;
        start_options: Record<string, Pick>;
        level18_options: Record<string, number>;
        boost?: number;
      } | null;
    }
  >;
};

export type PentakillRow = {
  /** Champion id, as the tables and pages use it ("MonkeyKing"). */
  champion: string;
  start: string;
  level18: string;
  startName: string;
  level18Name: string;
  startIcon: string;
  level18Icon: string;
  /** Estimated win rate points from both Empowers, as a fraction (0.004 = 0.4 points). */
  boost: number;
  /** Simulated: how much stronger each pick makes the champion, as a fraction. */
  startGain: number;
  level18Gain: number;
  /** The second-best start pick and how far behind it is, as a fraction. */
  runnerUp: string;
  margin: number;
};

type Ability = { slot: string; name: string; icon?: string };

export function pentakill(): PentakillRow[] {
  const data = readRepoJson<Data>("data/estimates/champion_upgrades.json");
  if (!data) return [];
  const byKey = new Map(Object.entries(championIds).map(([alias, key]) => [String(key), alias]));
  const client = windowJson<{ champions: { alias: string; abilities?: Ability[] }[] }>("champions/data.js");
  const abilities = new Map((client?.champions ?? []).map((c) => [c.alias, new Map((c.abilities ?? []).map((a) => [a.slot, a]))]));
  const rows: PentakillRow[] = [];
  for (const [key, c] of Object.entries(data.champions)) {
    const pk = c.pentakill;
    const champion = byKey.get(key);
    if (!pk || pk.boost == null || !champion) continue;
    const own = abilities.get(champion);
    const [first, second] = Object.entries(pk.start_options).sort((a, b) => b[1].score - a[1].score);
    rows.push({
      champion,
      start: pk.start,
      level18: pk.level18,
      startName: own?.get(pk.start)?.name ?? "",
      level18Name: own?.get(pk.level18)?.name ?? "",
      startIcon: own?.get(pk.start)?.icon ?? "",
      level18Icon: own?.get(pk.level18)?.icon ?? "",
      boost: pk.boost / 100,
      startGain: pk.start_options[pk.start].score / 100,
      level18Gain: pk.level18_options[pk.level18] / 100,
      runnerUp: second?.[0] ?? "",
      margin: second ? (first[1].score - second[1].score) / 100 : 0,
    });
  }
  return rows;
}
