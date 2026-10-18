import "server-only";
import { readRepoJson } from "./repo-data";

// Estimated stats (data/estimates/estimates.json, rebuilt daily; methods in data/estimates/README.md):
// numbers the live stats don't include, worked out from them. For a champion: each augment's win rate
// with it, likely augment pairs, a typical game's numbers and how far it sits from the average. Site-wide:
// items, augment stages and items, rarity odds, game length, side and top 10s. Pages label them as estimates.

type Band = "high" | "average" | "low";
type Rarity = "Silver" | "Gold" | "Prismatic";
type Estimates = {
  items?: { id: number; win_rate: number; lift: number; build_share: number; slots: number[] | null; granted: boolean }[];
  augment_stages?: Record<string, { stages: number[]; usual: number }>;
  augment_items?: Record<string, { id: number; share: number }[]>;
  rarity_odds?: { overall: Record<Rarity, number>; by_stage: Record<Rarity, number>[] };
  game_length?: { minutes: { mean: number; sd: number } };
  side?: { blue: number; red: number };
  fun?: Record<string, number[]>;
  augments?: Record<string, { id: number; pick_rate: number; win_rate: number; lift: number }[]>;
  augment_pairs?: Record<string, { ids: [number, number]; pick_rate: number; win_rate: number }[]>;
  profiles?: Record<string, Record<string, { value: number; band: Band } | Record<string, number>>>;
  vs_average?: Record<string, Record<string, { value: number; average: number; delta: number; percentile: number }>>;
  item_timing?: Record<string, { items: number[]; minutes: number[] }>;
};
type Stage = "early" | "mid" | "late";
type PowerCurve = {
  stages: Record<Stage, { level: number; items: number; augments: number }>;
  champions: Record<string, Record<Stage, number> & { scaling: number }>;
  early_game: number[];
  late_game: number[];
};

export type ProfileStat = { key: string; value: number; band: Band };
export type ChampionEstimates = {
  augments: Map<number, { winRate: number; lift: number }>;
  pairs: { ids: [number, number]; pickRate: number; winRate: number }[];
  profile: ProfileStat[];
  split: { physical: number; magic: number; true: number } | null;
  vsAverage: Map<string, number>;
  /** Minute each core item is usually finished. */
  timing: { id: number; minute: number }[];
  /** Simulated damage at three points of a game, as the share of champions it beats, plus a scaling score. */
  curve: {
    stages: { key: Stage; level: number; items: number; rank: number }[];
    scaling: number;
    topEarly: boolean;
    topLate: boolean;
  } | null;
};

export function championEstimates(id: number): ChampionEstimates | null {
  const e = readRepoJson<Estimates>("data/estimates/estimates.json");
  if (!e) return null;
  const k = String(id);
  const profile = e.profiles?.[k] ?? {};
  return {
    augments: new Map((e.augments?.[k] ?? []).map((a) => [a.id, { winRate: a.win_rate, lift: a.lift }])),
    pairs: (e.augment_pairs?.[k] ?? []).map((p) => ({
      ids: p.ids,
      pickRate: p.pick_rate,
      winRate: p.win_rate,
    })),
    profile: Object.entries(profile).flatMap(([key, v]) => ("band" in v && typeof v.value === "number" ? [{ key, value: v.value, band: v.band as Band }] : [])),
    split: (profile.damage_split as ChampionEstimates["split"]) ?? null,
    vsAverage: new Map(Object.entries(e.vs_average?.[k] ?? {}).map(([key, v]) => [key, v.delta])),
    timing: (() => {
      const t = e.item_timing?.[k];
      return t ? t.items.map((id, i) => ({ id, minute: t.minutes[i] })).filter((x) => typeof x.minute === "number") : [];
    })(),
    curve: powerCurve(id),
  };
}

function powerCurve(id: number): ChampionEstimates["curve"] {
  const pc = readRepoJson<PowerCurve>("data/estimates/power_curve.json");
  const c = pc?.champions[String(id)];
  if (!pc || !c) return null;
  return {
    stages: (["early", "mid", "late"] as const).map((key) => ({ key, level: pc.stages[key].level, items: pc.stages[key].items, rank: c[key] })),
    scaling: c.scaling,
    topEarly: pc.early_game.includes(id),
    topLate: pc.late_game.includes(id),
  };
}

let cache: Estimates | null | undefined;
const data = () => (cache === undefined ? (cache = readRepoJson<Estimates>("data/estimates/estimates.json")) : cache);

export type ItemEstimate = { winRate: number; lift: number; buildShare: number; slots: number[]; granted: boolean };
let items: Map<number, ItemEstimate> | null = null;
/** An item's estimated win rate, its lift over the champions who build it, its share of builds and how
 * often it is item 1, 2 or 3. */
export function itemEstimate(id: number): ItemEstimate | null {
  items ??= new Map(
    (data()?.items ?? []).map((i) => [i.id, { winRate: i.win_rate, lift: i.lift, buildShare: i.build_share, slots: i.slots ?? [], granted: i.granted }]),
  );
  return items.get(id) ?? null;
}

/** Share of an augment's picks at each of the four augment stages. */
export const augmentStages = (id: number) => data()?.augment_stages?.[String(id)] ?? null;

/** Items most built by the champions who take an augment, with the share of them who build it. */
export const augmentItems = (id: number) => data()?.augment_items?.[String(id)] ?? [];

/** How likely an augment pick is to be of a rarity, overall and at each stage. */
export function rarityOdds(rarity: string) {
  const r = (rarity[0].toUpperCase() + rarity.slice(1).toLowerCase()) as Rarity;
  const o = data()?.rarity_odds;
  return o ? { overall: o.overall[r], byStage: o.by_stage.map((s) => s[r]) } : null;
}

/** Typical game length in minutes and each side's win rate. */
export function typicalGame() {
  const d = data();
  return d?.game_length && d.side ? { minutes: d.game_length.minutes.mean, blue: d.side.blue, red: d.side.red } : null;
}

/** Short champion top 10s, keyed by what they rank. */
export const funLists = () => data()?.fun ?? {};

type CurveLists = { champions?: Record<string, { scaling: number }>; early_game?: number[]; late_game?: number[] };
let curveLists: CurveLists | null | undefined;
/** How each champion's simulated damage grows from level 8 to 18 (data/estimates/power_curve.json):
 * scaling above zero gets stronger late, below zero peaks early, plus the 10 most early and late game. */
export function powerCurveLists() {
  if (curveLists === undefined) curveLists = readRepoJson<CurveLists>("data/estimates/power_curve.json");
  return {
    scaling: new Map(Object.entries(curveLists?.champions ?? {}).map(([id, c]) => [Number(id), c.scaling])),
    early: curveLists?.early_game ?? [],
    late: curveLists?.late_game ?? [],
  };
}
