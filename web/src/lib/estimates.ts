import "server-only";
import { readRepoJson } from "./repo-data";

// Estimated stats (data/estimates/estimates.json, built daily by data/estimates/build.py; methods in its
// README): numbers the live stats don't include, worked out from them. The site labels every one as an
// estimate.

type Rarity = "Silver" | "Gold" | "Prismatic";
type Estimates = {
  patch: string;
  items?: { id: number; win_rate: number; lift: number; build_share: number; slots: number[] | null; granted: boolean }[];
  augment_stages?: Record<string, { stages: number[]; usual: number }>;
  augment_items?: Record<string, { id: number; share: number }[]>;
  rarity_odds?: { overall: Record<Rarity, number>; by_stage: Record<Rarity, number>[] };
  game_length?: { minutes: { mean: number; sd: number } };
  side?: { blue: number; red: number };
  fun?: Record<string, number[]>;
};

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
