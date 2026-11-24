// Champion stats over a chosen set of patches, plus each champion's DeepScore and tier (lib/deepscore.ts).
//
// Game counts aren't published, so a champion's sample size is estimated from pick rate × days:
// that's proportional to how many games they appear in. Across several patches, each older patch's
// games count for RECENT times the next one's, so a buff or nerf shows up quickly. DeepScore then ranks on
// the expected win rate next patch at the low end of its likely range, with settings fitted on past
// patches (lib/deepscore.ts FIT). Without them it falls back to the old rule: pulled toward the range's
// average by a beta prior worth PRIOR_STRENGTH "median champions' worth" of games.

import augmentNames from "@/data/augment-names.json";
import { DEEPSCORE_HELP, FIT, grade, lowerBound, nextPatch, trueSpread, type Noise } from "./deepscore";

const AUGS = augmentNames as Record<string, string>;

export type PatchRow = {
  patch: string;
  days: number;
  name: string;
  win_rate: number;
  pick_rate: number;
  damage: number | null;
  tank: number | null;
  kp: number | null;
  dead: number | null;
  /** The champion's most common augment ids that patch, comma separated. */
  augs: string;
};

export type ChampStats = {
  name: string;
  tier: string;
  /** 0-100, 50 is average (lib/deepscore.ts). */
  deepScore: number;
  /** Low end of the likely win rate, which DeepScore ranks on. */
  score: number;
  /** Expected win rate next patch if nothing about the champion changes, and its 80% range (fitted settings,
   *  lib/deepscore.ts FIT). Meant for a single patch: the backtest predicts from the latest patch alone. */
  next?: number;
  next_lo?: number;
  next_hi?: number;
  win_rate: number;
  pick_rate: number;
  damage: number | null;
  tank: number | null;
  kp: number | null;
  dead: number | null;
  patches: number;
  /** Est. share of all games (pick rate × days, normalised to the chosen range). */
  share: number;
  /** Effective games behind win_rate, for its 95% range (lib/stats.ts); only when matches per patch are given.
   *  With older patches weighted down, it's (Σ games × weight)² / Σ games × weight², a little under the raw total. */
  sample?: number;
  top_augments: string;
};

/** Pseudo-games per champion of median popularity; the prior is worth a quarter of that. */
const MEDIAN_GAMES = 1000;
const PRIOR_STRENGTH = 0.25;

/** Weight of each older patch's games relative to the next newer one. */
const RECENT = 0.5;

export const TIER_HELP = DEEPSCORE_HELP;

const weighted = (pairs: [number | null, number][]) => {
  let sum = 0;
  let w = 0;
  for (const [v, wt] of pairs) {
    if (v === null || !Number.isFinite(v)) continue;
    sum += v * wt;
    w += wt;
  }
  return w > 0 ? sum / w : null;
};

/** `matches`: estimated matches behind each patch's numbers (lib/sample.ts), to give each champion's `sample`. */
/** `ownDays`: a champion's pick rate counts only the days of the patches it has rows for (the Tier List's "16.23+" view
 *  leaves out a champion's earlier patch when its win rate moved sharply, ChampionTiers). */
export function champStats(rows: PatchRow[], patches: Set<string>, matches?: Record<string, number>, ownDays = false): ChampStats[] {
  const picked = rows.filter((r) => patches.has(r.patch));
  const totalDays = [...new Set(picked.map((r) => `${r.patch}:${r.days}`))].reduce((d, k) => d + Number(k.split(":")[1]), 0);
  // Patches newest first, to weigh older ones down.
  const order = [...new Set(picked.map((r) => r.patch))].reverse();
  const recency = new Map(order.map((p, i) => [p, RECENT ** i]));
  const byChamp = new Map<string, PatchRow[]>();
  for (const r of picked) byChamp.set(r.name, [...(byChamp.get(r.name) ?? []), r]);

  const base = [...byChamp].map(([name, rs]) => {
    const g = rs.map((r) => r.pick_rate * r.days);
    const w = rs.map((r, i) => g[i] * (recency.get(r.patch) ?? 1));
    const latest = rs[rs.length - 1]; // rows arrive oldest patch first (no .at(): older Safari lacks it)
    const games = g.reduce((a, b) => a + b, 0);
    // Real games per patch (pick rate × matches), weighted like the win rate.
    let sw = 0;
    let sw2 = 0;
    for (const r of rs) {
      const real = r.pick_rate * (matches?.[r.patch] ?? NaN);
      const rec = recency.get(r.patch) ?? 1;
      sw += real * rec;
      sw2 += real * rec * rec;
    }
    return {
      name,
      games,
      ...(matches && sw2 > 0 ? { sample: (sw * sw) / sw2 } : {}),
      win_rate: weighted(rs.map((r, i) => [r.win_rate, w[i]]))!,
      pick_rate: (() => {
        const days = ownDays ? rs.reduce((d, r) => d + r.days, 0) : totalDays;
        return days ? games / days : 0;
      })(),
      damage: weighted(rs.map((r, i) => [r.damage, w[i]])),
      tank: weighted(rs.map((r, i) => [r.tank, w[i]])),
      kp: weighted(rs.map((r, i) => [r.kp, w[i]])),
      dead: weighted(rs.map((r, i) => [r.dead, w[i]])),
      patches: rs.length,
      top_augments: latest.augs
        .split(",")
        .map((id) => AUGS[id.trim()])
        .filter(Boolean)
        .join(", "),
    };
  });
  if (!base.length) return [];

  const sortedGames = base.map((b) => b.games).sort((a, b) => a - b);
  const median = sortedGames[Math.floor(sortedGames.length / 2)] || 1;
  const mean = weighted(base.map((b) => [b.win_rate, b.games])) ?? 0.5;
  const prior = MEDIAN_GAMES * PRIOR_STRENGTH;
  const allGames = base.reduce((a, b) => a + b.games, 0) || 1;

  const fit = FIT.champions;
  // Sampling noise, when real game counts are known: matters only for a champion with very few games.
  const vOf = (b: (typeof base)[number]) =>
    "sample" in b && b.sample && b.sample > 0 ? (b.win_rate * (1 - b.win_rate)) / b.sample : 0;
  const tau2 = trueSpread(
    base.map((b) => b.win_rate),
    base.map(vOf),
  );
  const scored = base
    .map((b) => {
      const share = b.games / allGames;
      if (!fit) return { ...b, share, score: lowerBound(b.win_rate, (b.games / median) * MEDIAN_GAMES, mean, prior) };
      const v = vOf(b);
      const noise: Noise | undefined = v > 0 ? { v, tau2 } : undefined;
      const { est, sd } = nextPatch(b.win_rate, b.games / median, mean, fit, noise);
      const half = fit.q80 * sd;
      return { ...b, share, score: est - sd, next: est, next_lo: est - half, next_hi: est + half };
    })
    .sort((a, b) => b.score - a.score);
  const grades = grade(scored.map((b) => b.score));
  return scored.map(({ games, ...rest }, i) => {
    void games;
    return { ...rest, ...grades[i] };
  });
}

/** The "{live}+" rows (Nico 2026-11-24, like the augment list's switch from #643): the live patch's rows plus the patch
 *  before's, except a champion whose win rate moved by more than 4 standard errors between the two (a big buff or nerf),
 *  who keeps the live patch alone. Pass to champStats with both patches and ownDays, so the earlier patch counts at
 *  half weight per game (RECENT). */
export function plusRows(rows: PatchRow[], live: string, before: string, matches?: Record<string, number>): PatchRow[] {
  const liveRows = new Map(rows.filter((r) => r.patch === live).map((r) => [r.name, r]));
  const agree = (r: PatchRow) => {
    const l = liveRows.get(r.name);
    if (!l) return false;
    const nL = l.pick_rate * (matches?.[live] ?? 0);
    const nP = r.pick_rate * (matches?.[before] ?? 0);
    if (!nL || !nP) return true;
    const p = (l.win_rate + r.win_rate) / 2;
    return Math.abs(l.win_rate - r.win_rate) <= 4 * Math.sqrt(p * (1 - p) * (1 / nL + 1 / nP));
  };
  return rows.filter((r) => r.patch === live || (r.patch === before && agree(r)));
}
