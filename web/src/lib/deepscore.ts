// DeepScore: one 0-100 rating for every champion and augment on the tier lists, and the tier it falls in.
//
// 1. Prediction: champions, augments and a champion's items are scored on their expected win rate next patch,
//    with settings fitted on past patches (FIT below, data/analysis/predictive.py), at the low end of its
//    likely range (estimate minus one typical miss). Backtests showed the old rule, pulling rarely picked
//    entries harder toward the average, predicted next patch worse: with this many games, a rare pick's
//    lead is mostly real. A champion's lists (augments, spell pairs, starters, boots, cores, builds, single
//    items) all use this one rule (Nico 2026-11-24), on the items fit where they have no fit of their own. Lists
//    without real games or history (duos, the item tier pages) keep the old beta prior (lowerBound).
// 2. Recency: across several patches, older patches count for less (champions: lib/tiers.ts).
// 3. Spread: scores become z-scores against the rest of the list (50 is average, each 15 points is one
//    standard deviation), and tiers are cut at fixed z-scores, so they stay balanced as averages drift.
// 4. Augments are judged against what the champions who take them win anyway (lib/augment-tiers.ts).

import fitFile from "@/data/deepscore-fit.json";
import { DEEPSCORE_ONE_LINE, tierOfScore } from "./deepscore-scale";

/** How many standard deviations below the estimate the score sits. */
const Z = 1;

// Fitted settings (data/analysis/predictive.py, refreshed daily): how much of a win rate's lead over its list
// carried over to the next patch in past patches, and how far the next patch's win rate typically landed from
// the estimate. est = m + b * n / (n + k) * (x - m), with n the pick rate over the list's median pick rate;
// sd = sqrt(s0² + s1² / n); q80/q95 are the multiples of sd that held 80% / 95% of past misses.
// A list without enough history keeps the old hand-set prior (k = 0.25, no carry-over fit).
export type Fit = { b: number; k: number; s0: number; s1: number; q50: number; q80: number; q95: number; r?: number };
type FitFile = { champions?: Fit | null; augments?: Fit | null; items?: Fit | null };
const FILE = fitFile as FitFile;
export const FIT: { champions: Fit | null; augments: Fit | null; items: Fit | null } = {
  champions: FILE.champions ?? null,
  augments: FILE.augments ?? null,
  items: FILE.items ?? null,
};

/** Sampling noise in a win rate's estimate: its variance `v` (p(1-p)/games) and the spread of true win rates
 *  across the list `tau2`. The fit was made on lists where every entry had thousands of games; when an entry
 *  has few real games, its lead is first shrunk by tau2 / (tau2 + v) (empirical Bayes), and v widens its range. */
export type Noise = { v: number; tau2: number };

/** Expected next-patch win rate and its typical miss, for a win rate `x` with `n` = pick rate / list median. */
export function nextPatch(x: number, n: number, mean: number, fit: Fit, noise?: Noise): { est: number; sd: number } {
  let w = fit.k > 0 ? (fit.b * n) / (n + fit.k) : fit.b;
  let var2 = fit.s0 ** 2 + fit.s1 ** 2 / Math.max(n, 1e-3);
  if (noise && noise.v > 0) {
    w *= noise.tau2 / (noise.tau2 + noise.v);
    var2 += noise.v;
  }
  return { est: mean + w * (x - mean), sd: Math.sqrt(var2) };
}

/** The list's spread of true win rates, by the method of moments: the spread of the observed ones minus their
 *  average sampling variance, kept above a small floor. */
export function trueSpread(xs: number[], vs: number[]): number {
  if (!xs.length) return 1e-4;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const total = xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
  const noise = vs.reduce((a, b) => a + b, 0) / Math.max(vs.length, 1);
  return Math.max(total - noise, 1e-5);
}

/** The low end (one typical miss below) of the expected next-patch win rate, which DeepScore ranks on. */
export function fittedBound(x: number, n: number, mean: number, fit: Fit, noise?: Noise): number {
  const { est, sd } = nextPatch(x, n, mean, fit, noise);
  return est - Z * sd;
}

/** The low end of a win rate's likely range, after pulling it toward `mean` with `prior` pseudo-games. */
export function lowerBound(
  winRate: number,
  games: number,
  mean: number,
  prior: number,
): number {
  const n = games + prior;
  const est = (winRate * games + mean * prior) / n;
  return est - Z * Math.sqrt((est * (1 - est)) / n);
}

// The DeepScore scale itself (0-100, tier cuts, colours) lives in lib/deepscore-scale.ts, with no data imports, so
// client badges and the apps share it. Tiers are cut on the rounded score, so a badge's colour and its tier chip always
// agree with the printed cuts ("S 70+").

/** deepScore: 0-100 against the list. tier: S-D from it. edge: how far the value sits above the list's average, in
 *  win-rate points (the values are win rates or win-rate leads), for the badge's hover ("about +2.1 pts"). */
export type Graded = { deepScore: number; tier: string; edge: number };

/** DeepScore and tier for each value, against the whole list's spread. */
export function grade(values: number[]): Graded[] {
  if (!values.length) return [];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd =
    Math.sqrt(
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length,
    ) || 1;
  return values.map((v) => {
    const z = (v - mean) / sd;
    const deepScore = Math.round(Math.min(100, Math.max(0, 50 + 15 * z)));
    return { deepScore, tier: tierOfScore(deepScore), edge: Math.round((v - mean) * 1000) / 10 || 0 };
  });
}

// Every DeepScore hover: the one shared line (lib/deepscore-scale.ts), then what this list compares (Nico 2026-11-24:
// one consistent explanation everywhere). The badge adds "about +X win-rate pts" from the row's edge.
const help = (what: string) => `${DEEPSCORE_ONE_LINE} ${what}`;

export const DEEPSCORE_HELP = help(
  "It starts from win rate, predicts next patch's from how win rates moved between past patches, counts the newest patch most and trusts picks with few games less.",
);

export const AUGMENT_DEEPSCORE_HELP = help(
  "Augments are compared with others of the same rarity, against what the same champions win anyway, so augments that strong champions take don't look better than they are.",
);

export const ITEM_DEEPSCORE_HELP = help(
  "Items are compared with this champion's other items of the same tier, and rarely built items are trusted less.",
);

export const BUILD_DEEPSCORE_HELP = help(
  "Builds are compared with this champion's other builds in the same list, and rarely built ones are trusted less.",
);

export const ITEM_TIER_DEEPSCORE_HELP = help(
  "Items are compared with the other items of their tier by how much they raise the win rate of the champions who build them, and rarely built items are trusted less.",
);
