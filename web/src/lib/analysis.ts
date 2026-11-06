import "server-only";
import { readRepoJson } from "./repo-data";

// Readers for the analyses in data/analysis (patch-change impact, meta settling and mid-patch shifts, playstyle
// clusters, pre-patch forecast). Each file is rebuilt by the daily estimates workflow; every reader returns null
// or an empty list when a file is missing, so pages render without it.

export type Dose = { damage_dealt: number; damage_taken: number; healing: number; shielding: number; ability: number; lines: number; parsed: number; intent: "buff" | "nerf" | "unclear" };
export type ImpactRow = {
  alias: string;
  name: string;
  before: number;
  after: number;
  delta: number;
  effect: number;
  se: number;
  ci: [number, number];
  z: number;
  verdict: "worked" | "opposite" | "noise" | "moved";
  dose: Dose;
  lines: string[];
};
export type ImpactPatch = { patch: string; prev: string; control: { n: number; mean: number; sd: number }; champions: ImpactRow[] };
type Coefficient = { pts_per_5pct: number; ci: [number, number] };
export type DoseResponse = {
  n: number;
  r2?: number;
  coefficients?: Record<"intercept" | "damage_dealt" | "damage_taken" | "healing" | "shielding" | "ability", Coefficient>;
  buffs?: { n: number; mean_effect: number; share_positive: number | null };
  nerfs?: { n: number; mean_effect: number; share_negative: number | null };
};
type Impact = { built: string; patches: ImpactPatch[]; placebo_sd: number | null; dose_response: DoseResponse };

export type SettlingPatch = { patch: string; days: number; champions: number; spearman: number[]; mad_pts: number[]; settled_day: number | null };
export type Shift = { patch: string; alias: string; name: string; day: number; date: string; before: number; after: number; shift: number; z: number };
type Settling = {
  built: string;
  settled_at: number;
  patches: SettlingPatch[];
  typical: { spearman: number[]; mad_pts: number[] };
  typical_settled_day: number | null;
  live: { patch: string; day: number; typical_spearman: number | null; typical_mad_pts: number | null } | null;
  shifts: Shift[];
  events: { patch: string; date: string; champions: string[] }[];
};

export type Cluster = { id: number; label: string; size: number; profile: Record<string, number>; classes: { name: string; count: number }[]; champions: string[] };
export type ClusterChampion = { alias: string; name: string; cluster: number; x: number; y: number; classes: string[]; unlike_class: boolean };
type Clusters = { built: string; k: number; silhouette: number; features: { stats: string[]; augments: number; patches: number }; clusters: Cluster[]; champions: ClusterChampion[] };

export type ForecastEntry = { name: string; alias: string | null; display: string; tag: string; predicted_pts: number; range_pts: [number, number]; parsed: number; lines: number };
type Forecast = {
  built: string;
  model: { n: number; patches?: number; cv_mae_pts?: number; cv_rmse_pts?: number; baseline_no_change_mae_pts?: number; baseline_buff_or_nerf_mae_pts?: number };
  pbe: { build: string | null; live: string | null; dataAsOf: string | null; entries: ForecastEntry[] } | null;
};

export type ItemLift = { raw: number; adjusted: number; premium: number; weight: number; rank_raw?: number; rank_adjusted?: number };
type ItemLifts = {
  built: string;
  premium: { champions: number; mean: number; sd: number; share_positive: number | null };
  ranked: number;
  moved_ten: number;
  items: Record<string, ItemLift>;
  moved: { id: number; from: number; to: number }[];
  archive: { games: number; win_rate: number | null; rows: { completed: number; games: number; win_rate: number; ci: [number, number] }[] } | null;
};
export type LengthCurve = { games: number; median: number | null; quartiles: [number | null, number | null]; survival: number[]; hazard: number[] };
export type GameLength = {
  built: string;
  games: number;
  remakes_excluded: number;
  curves: Record<"all" | "win" | "loss" | "blue" | "red", LengthCurve>;
  peak_minute: number | null;
  compare: Record<"win_vs_loss" | "blue_vs_red", { z: number; p: number; longer: string }>;
};

const impact = () => readRepoJson<Impact>("data/analysis/patch_impact.json");
const settling = () => readRepoJson<Settling>("data/analysis/meta_settling.json");
const clusters = () => readRepoJson<Clusters>("data/analysis/playstyle_clusters.json");
const forecast = () => readRepoJson<Forecast>("data/analysis/patch_forecast.json");
const lifts = () => readRepoJson<ItemLifts>("data/analysis/item_lift.json");
const length = () => readRepoJson<GameLength>("data/analysis/game_length.json");

/** The measured effect of every champion change the notes listed for a patch, biggest move first. */
export const patchImpact = (patch: string): ImpactPatch | null => impact()?.patches.find((p) => p.patch === patch) ?? null;

export const doseResponse = (): DoseResponse | null => impact()?.dose_response ?? null;

/** Win-rate points a +5% Mayhem damage-dealt modifier is worth, with its interval, when the fit has one. */
export function damageDealtWorth(): { pts: number; ci: [number, number]; n: number } | null {
  const d = doseResponse();
  const c = d?.coefficients?.damage_dealt;
  return c && d ? { pts: c.pts_per_5pct, ci: c.ci, n: d.n } : null;
}

export const settlingOf = (patch: string): SettlingPatch | null => settling()?.patches.find((p) => p.patch === patch) ?? null;

/** The median day-by-day closeness to the final ranking over finished patches (index 0 = day 1). */
export const typicalSettling = () => {
  const s = settling();
  return s ? { spearman: s.typical.spearman, mad_pts: s.typical.mad_pts, settledDay: s.typical_settled_day, live: s.live } : null;
};

export const shiftsOf = (patch: string): Shift[] => settling()?.shifts.filter((s) => s.patch === patch) ?? [];
export const shiftEvents = () => settling()?.events ?? [];

export const playstyleClusters = (): Clusters | null => clusters();

/** The playstyle cluster a champion sits in, with its label and whether it plays unlike its class. */
export function playstyleOf(alias: string): { label: string; unlikeClass: boolean; size: number } | null {
  const c = clusters();
  const ch = c?.champions.find((x) => x.alias === alias);
  if (!c || !ch) return null;
  const cl = c.clusters[ch.cluster];
  return cl ? { label: cl.label, unlikeClass: ch.unlike_class, size: cl.size } : null;
}

export const pbeForecast = () => forecast();

/** An item's lift measured against its champions' finished builds instead of their overall win rate (data/analysis/item_lift.py). */
export const itemLift = (id: number): ItemLift | null => lifts()?.items[String(id)] ?? null;

/** The finished-build premium across champions and how many legendary items changed rank, for the Methodology page. */
export function itemLiftSummary() {
  const l = lifts();
  if (!l) return null;
  return { premium: l.premium, ranked: l.ranked, moved: l.moved_ten, archive: l.archive };
}

/** How long games last, from the survival analysis of the owner's archive; null until the archive aggregates exist. */
export const gameLength = (): GameLength | null => length();
