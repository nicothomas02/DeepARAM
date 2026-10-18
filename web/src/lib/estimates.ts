import "server-only";
import { readRepoJson } from "./repo-data";

// Estimated stats for a champion (data/estimates/estimates.json, rebuilt daily; methods in
// data/estimates/README.md): each augment's win rate with this champion, likely augment pairs, a
// typical game's numbers, and how far the champion sits from the average. Pages label them as estimates.

type Band = "high" | "average" | "low";
type Estimates = {
  augments?: Record<
    string,
    { id: number; pick_rate: number; win_rate: number; lift: number }[]
  >;
  augment_pairs?: Record<
    string,
    { ids: [number, number]; pick_rate: number; win_rate: number }[]
  >;
  profiles?: Record<
    string,
    Record<string, { value: number; band: Band } | Record<string, number>>
  >;
  vs_average?: Record<
    string,
    Record<
      string,
      { value: number; average: number; delta: number; percentile: number }
    >
  >;
};

export type ProfileStat = { key: string; value: number; band: Band };
export type ChampionEstimates = {
  augments: Map<number, { winRate: number; lift: number }>;
  pairs: { ids: [number, number]; pickRate: number; winRate: number }[];
  profile: ProfileStat[];
  split: { physical: number; magic: number; true: number } | null;
  vsAverage: Map<string, number>;
};

export function championEstimates(id: number): ChampionEstimates | null {
  const e = readRepoJson<Estimates>("data/estimates/estimates.json");
  if (!e) return null;
  const k = String(id);
  const profile = e.profiles?.[k] ?? {};
  return {
    augments: new Map(
      (e.augments?.[k] ?? []).map((a) => [
        a.id,
        { winRate: a.win_rate, lift: a.lift },
      ]),
    ),
    pairs: (e.augment_pairs?.[k] ?? []).map((p) => ({
      ids: p.ids,
      pickRate: p.pick_rate,
      winRate: p.win_rate,
    })),
    profile: Object.entries(profile).flatMap(([key, v]) =>
      "band" in v && typeof v.value === "number"
        ? [{ key, value: v.value, band: v.band as Band }]
        : [],
    ),
    split: (profile.damage_split as ChampionEstimates["split"]) ?? null,
    vsAverage: new Map(
      Object.entries(e.vs_average?.[k] ?? {}).map(([key, v]) => [key, v.delta]),
    ),
  };
}
