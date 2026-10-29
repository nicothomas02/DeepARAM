// Champion stats over a chosen set of patches, plus each champion's DeepScore and tier (lib/deepscore.ts).
//
// Game counts aren't published, so a champion's sample size is estimated from pick rate × days:
// that's proportional to how many games they appear in. Across several patches, each older patch's
// games count for RECENT times the next one's, so a buff or nerf shows up quickly. The win rate is then
// pulled toward the range's average (a beta prior worth PRIOR_STRENGTH "median champions' worth" of
// games) and scored at the low end of its likely range, so a rarely picked champion needs a bigger edge.

import augmentNames from "@/data/augment-names.json";
import { DEEPSCORE_HELP, grade, lowerBound } from "./deepscore";

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
  win_rate: number;
  pick_rate: number;
  damage: number | null;
  tank: number | null;
  kp: number | null;
  dead: number | null;
  patches: number;
  /** Est. share of all games (pick rate × days, normalised to the chosen range). */
  share: number;
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

/**
 * The n biggest win-rate gains and the n biggest drops, biggest first. Only gains go in `up` and only drops in
 * `down`: when fewer than 2n champions moved, taking the first and last n of one sorted list would put the same
 * champion in both, and list a champion that rose among the drops.
 */
export function risersAndFallers<T extends { change: number }>(list: T[], n: number): { up: T[]; down: T[] } {
  const sorted = [...list].sort((a, b) => b.change - a.change);
  return { up: sorted.filter((c) => c.change > 0).slice(0, n), down: sorted.filter((c) => c.change < 0).slice(-n).reverse() };
}

export function champStats(rows: PatchRow[], patches: Set<string>): ChampStats[] {
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
    return {
      name,
      games,
      win_rate: weighted(rs.map((r, i) => [r.win_rate, w[i]]))!,
      pick_rate: totalDays ? games / totalDays : 0,
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

  const scored = base
    .map((b) => {
      const n = (b.games / median) * MEDIAN_GAMES;
      return { ...b, share: b.games / allGames, score: lowerBound(b.win_rate, n, mean, prior) };
    })
    .sort((a, b) => b.score - a.score);
  const grades = grade(scored.map((b) => b.score));
  return scored.map(({ games, ...rest }, i) => {
    void games;
    return { ...rest, ...grades[i] };
  });
}
