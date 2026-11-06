// Confidence intervals and sample-size checks for win rates. Mirrors data/stats/intervals.py, so the site,
// the data builders and the notebooks all draw the same ranges.
//
// - wilson(): the Wilson score interval. Unlike "rate ± 1.96 standard errors" it stays inside 0-100% and
//   behaves with few games or rates near the ends.
// - diffInterval(): Newcombe's hybrid score interval for the difference of two rates, for lift (a pair's
//   win rate against what its parts win anyway). Pass Infinity as n2 for a fixed baseline.
// - sampleLevel(): "none" below MIN_GAMES (too few to show a win rate at all), "low" while the 95% range is
//   wider than ±NOISE_HALF_WIDTH (a few points either way is noise), else "ok".
//
// Game counts come from lib/sample.ts (estimated per patch by data/stats/games.py).

export const Z95 = 1.959963984540054;
export const MIN_GAMES = 10;
export const NOISE_HALF_WIDTH = 0.05;

export type Interval = [lo: number, hi: number];
export type SampleLevel = "none" | "low" | "ok";

/** 95% (by default) Wilson score interval for a rate p seen over n games. */
export function wilson(p: number, n: number, z = Z95): Interval {
  if (!(n > 0)) return [0, 1];
  const q = Math.min(1, Math.max(0, p));
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (q + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((q * (1 - q)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Half the width of the Wilson interval: the "±" to show. */
export function halfWidth(p: number, n: number, z = Z95): number {
  const [lo, hi] = wilson(p, n, z);
  return (hi - lo) / 2;
}

/** Interval for p1 - p2 from independent samples (Newcombe hybrid score); n2 = Infinity for a fixed baseline. */
export function diffInterval(p1: number, n1: number, p2: number, n2: number, z = Z95): Interval {
  const [l1, u1] = wilson(p1, n1, z);
  const [l2, u2] = Number.isFinite(n2) ? wilson(p2, n2, z) : [p2, p2];
  const d = p1 - p2;
  return [d - Math.hypot(p1 - l1, u2 - p2), d + Math.hypot(u1 - p1, p2 - l2)];
}

/** How far a win rate p over n games can be trusted (p = 0.5 is the worst case). */
export function sampleLevel(n: number | undefined, p = 0.5): SampleLevel {
  if (n === undefined || !(n >= MIN_GAMES)) return "none";
  return halfWidth(p, n) > NOISE_HALF_WIDTH ? "low" : "ok";
}

/** Fewest games for a 95% range of ±half (normal approximation). */
export function gamesNeeded(half = NOISE_HALF_WIDTH, p = 0.5, z = Z95): number {
  return Math.ceil((z * z * p * (1 - p)) / (half * half));
}
