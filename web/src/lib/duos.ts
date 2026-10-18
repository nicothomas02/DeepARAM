import "server-only";
import championIds from "@/data/champion-ids.json";
import { liveWithChange } from "./champions";
import { readRepoJson } from "./repo-data";
import { synergy } from "./synergy";

type Duos = { duos: { champion_ids?: number[]; names: string[]; roles?: string[]; win_rate: number; pick_rate: number; rank?: number }[] };

export const hasDuos = () => Boolean(readRepoJson<Duos>("data/cn/duos.json")?.duos.length);

const ALIAS = Object.fromEntries(Object.entries(championIds as Record<string, number>).map(([a, id]) => [id, a]));

// delta: the pair's synergy on the live patch, how much more it wins than the two champions' own win
// rates predict (lib/synergy.ts; the champion page's Best teammates uses the same formula).
export const duoRows = () => {
  const rates = new Map(liveWithChange().live.map((c) => [c.name, c.win_rate]));
  return (readRepoJson<Duos>("data/cn/duos.json")?.duos ?? []).map((d) => {
    const [x, y] = (d.champion_ids ?? []).map((id) => rates.get(ALIAS[id]));
    return {
      a: d.names[0],
      b: d.names[1],
      pair: d.names.join(" "),
      win_rate: d.win_rate,
      delta: x === undefined || y === undefined ? null : synergy(d.win_rate, x, y, d.pick_rate),
      pick_rate: d.pick_rate,
      rank: d.rank ?? null,
      roles: (d.roles ?? []).map((r) => r.replace(/,/g, "/")).join(" + "),
    };
  });
};
