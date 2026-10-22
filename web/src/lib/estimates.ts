import "server-only";
import { readRepoCsv, readRepoJson } from "./repo-data";

// Estimated stats (data/estimates/estimates.json, rebuilt daily; methods in data/estimates/README.md):
// numbers the live stats don't include, worked out from them. For a champion: each augment's win rate
// with it, likely augment pairs, a typical game's numbers and how far it sits from the average. Site-wide:
// items, augment stages and items, rarity odds, game length, side and top 10s. Pages label them as estimates.

type Band = "high" | "average" | "low";
type Rarity = "Silver" | "Gold" | "Prismatic";
type Estimates = {
  patch?: string;
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

/** A champion's estimated typical-game number for one profile stat (heal_per_min, cc_seconds, ...). */
export function profileValue(id: number, key: string) {
  const v = data()?.profiles?.[String(id)]?.[key];
  return v && "value" in v && typeof v.value === "number" ? v.value : null;
}

type CurveLists = {
  champions?: Record<string, Record<Stage, number> & { scaling: number }>;
  early_game?: number[];
  late_game?: number[];
};
let curveLists: CurveLists | null | undefined;
/** How each champion's simulated damage grows from level 8 to 18 (data/estimates/power_curve.json):
 * scaling above zero gets stronger late, below zero peaks early, plus the 10 most early and late game. */
export function powerCurveLists() {
  if (curveLists === undefined) curveLists = readRepoJson<CurveLists>("data/estimates/power_curve.json");
  return {
    scaling: new Map(Object.entries(curveLists?.champions ?? {}).map(([id, c]) => [Number(id), c.scaling])),
    /** Share of champions each one out-damages at level 8 and at level 18. */
    ranks: new Map(Object.entries(curveLists?.champions ?? {}).map(([id, c]) => [Number(id), { early: c.early, late: c.late }])),
    early: curveLists?.early_game ?? [],
    late: curveLists?.late_game ?? [],
  };
}

// Win rate boosts of an augment across champions, or of a champion across augments, read as one spread:
// the pick-weighted standard deviation. A spread resting on few picks is pulled toward the typical one.
const PULL = 10;
function spreads<K>(groups: Map<K, [number, number][]>) {
  const raw = [...groups].flatMap(([k, xs]) => {
    const w = xs.reduce((s, [x]) => s + x, 0);
    if (xs.length < 3 || w <= 0) return [];
    const mean = xs.reduce((s, [x, v]) => s + x * v, 0) / w;
    const variance = xs.reduce((s, [x, v]) => s + x * (v - mean) ** 2, 0) / w;
    return [{ k, variance, n: w ** 2 / xs.reduce((s, [x]) => s + x * x, 0) }];
  });
  const sorted = raw.map((r) => r.variance).sort((a, b) => a - b);
  const typical = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return new Map(raw.map(({ k, variance, n }) => [k, Math.round(Math.sqrt((n * variance + PULL * typical) / (n + PULL)) * 1e4) / 1e4]));
}

let spreadCache: { augments: Map<number, number>; champions: Map<number, number> } | undefined;
function augmentSpreads() {
  if (spreadCache) return spreadCache;
  const e = data();
  const pick = new Map(
    (readRepoCsv("data/cn/history/by_patch.csv") ?? []).filter((r) => r.patch === e?.patch).map((r) => [r.champion_id, Number(r.pick_rate)]),
  );
  const byAugment = new Map<number, [number, number][]>();
  const byChampion = new Map<number, [number, number][]>();
  for (const [c, list] of Object.entries(e?.augments ?? {})) {
    const p = pick.get(c);
    if (!p) continue;
    byChampion.set(Number(c), list.map((a) => [a.pick_rate, a.lift]));
    for (const a of list) {
      if (!byAugment.has(a.id)) byAugment.set(a.id, []);
      byAugment.get(a.id)!.push([p * a.pick_rate, a.lift]);
    }
  }
  return (spreadCache = { augments: spreads(byAugment), champions: spreads(byChampion) });
}

/** How much an augment's estimated win rate boost changes from one champion that takes it to the next
 * (a typical gap, as a share: 0.02 is 2 pts). High: great on some champions, poor on others. */
export const augmentSpread = (id: number) => augmentSpreads().augments.get(id) ?? null;

/** How much a champion's estimated win rate changes with the augments it takes (a typical gap, as a share).
 * High: the champion leans on getting the right augments. */
export const championAugmentReliance = () => augmentSpreads().champions;
