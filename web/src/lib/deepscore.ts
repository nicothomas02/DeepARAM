// DeepScore: one 0-100 rating for every champion and augment on the tier lists, and the tier it falls in.
//
// 1. Prediction: champions, augments and a champion's items are scored on their expected win rate next patch,
//    with settings fitted on past patches (FIT below, data/analysis/predictive.py), at the low end of its
//    likely range (estimate minus one typical miss). Backtests showed the old rule, pulling rarely picked
//    entries harder toward the average, predicted next patch worse: with this many games, a rare pick's
//    lead is mostly real. Lists without enough history (builds, spell pairs, duos, item tiers) keep the old
//    beta prior (lowerBound).
// 2. Recency: across several patches, older patches count for less (champions: lib/tiers.ts).
// 3. Spread: scores become z-scores against the rest of the list (50 is average, each 15 points is one
//    standard deviation), and tiers are cut at fixed z-scores, so they stay balanced as averages drift.
// 4. Augments are judged against what the champions who take them win anyway (lib/augment-tiers.ts).

import fitFile from "@/data/deepscore-fit.json";

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

/** Lowest z-score for each tier, best first. On a normal spread: S ~9%, A ~18%, B ~38%, C ~23%, D ~12%. */
export const TIER_Z: [string, number][] = [
  ["S", 1.35],
  ["A", 0.6],
  ["B", -0.4],
  ["C", -1.2],
  ["D", -Infinity],
];

export type Graded = { deepScore: number; tier: string };

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
    return {
      deepScore: Math.round(Math.min(100, Math.max(0, 50 + 15 * z))),
      tier: TIER_Z.find(([, min]) => z >= min)![0],
    };
  });
}

const CUTS = TIER_Z.slice(0, -1)
  .map(([t, z]) => `${t} ${Math.round(50 + 15 * z)}+`)
  .join(", ");

export const DEEPSCORE_HELP =
  "DeepScore rates each pick from 0 to 100, where 50 is average. It starts from win rate, predicts what the pick " +
  "will win next patch from how win rates moved between past patches, counts the newest patch most, and compares " +
  "each pick with the rest of the list. " +
  `Tiers: ${CUTS}, D below.`;

export const AUGMENT_DEEPSCORE_HELP =
  "DeepScore rates each augment from 0 to 100 against others of its rarity, where 50 is average. It compares the " +
  "augment's win rate with what the same champions win anyway, so augments that strong champions take don't look " +
  `better than they are, and predicts how much of its edge lasts into next patch. Tiers: ${CUTS}, D below.`;

/** The champion page's augment list: DeepScore from the augment's grade on that champion (lib/champion-augment-scores.ts). */
export const CHAMPION_AUGMENT_DEEPSCORE_HELP =
  "On a champion's page, DeepScore follows each augment's grade on that champion: S 70+, A 59+, B 44+, C 32+. " +
  "Within a grade, the more often the champion takes it, the higher it scores.";

export const ITEM_DEEPSCORE_HELP =
  "DeepScore rates each item from 0 to 100 against this champion's other items of the same tier, where 50 is average. It starts " +
  `from the item's win rate with this champion and trusts rarely built items less. Tiers: ${CUTS}, D below.`;

export const BUILD_DEEPSCORE_HELP =
  "DeepScore rates each build from 0 to 100 against this champion's other builds in the same list, where 50 is average. " +
  `It starts from the build's win rate with this champion and trusts rarely built ones less. Tiers: ${CUTS}, D below.`;

export const ITEM_TIER_DEEPSCORE_HELP =
  "DeepScore rates each item from 0 to 100 against the other items of its tier, where 50 is average. It starts from how much " +
  `the item raises the win rate of the champions who build it and trusts rarely built items less. Tiers: ${CUTS}, D below.`;
