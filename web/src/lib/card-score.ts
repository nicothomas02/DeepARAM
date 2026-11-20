import { fittedBound, grade, lowerBound, type Fit } from "./deepscore";
import type { ItemTier } from "./items";

// Scoring shared by the champion page's server code (lib/champion-page.ts) and the top card's timeframe picker,
// which re-ranks builds in the browser for the patches picked (components/champion/Timeframe.tsx).

/** games: estimated live-patch games behind winRate (the champion's games × pickRate), for its 95% range. */
export type Rated = { winRate: number; pickRate: number; lift: number; games?: number };
export type ItemRow = Rated & {
  items: number[];
  deepScore?: number;
  tier?: ItemTier;
  /** Core builds: the boots that go with the core. */
  boots?: number;
  /** Core builds: how many core items come before the boots (simulated, data/estimates/boots_timing.json). */
  bootsAt?: number;
};

/** A row's items in the order they're bought: the boots go in at bootsAt (last when it isn't known, as real data
 *  doesn't say when they're bought). */
export function buildOrder(r: ItemRow): number[] {
  if (r.boots === undefined) return r.items;
  const at = Math.min(r.bootsAt ?? r.items.length, r.items.length);
  return [...r.items.slice(0, at), r.boots, ...r.items.slice(at)];
}

const MEDIAN_GAMES = 1000; // pseudo-games for an item of median popularity, as on the Tier List
const PRIOR = 0.25; // the average's weight, in median items' worth of games

/** DeepScore for each row against the rest of the champion's list (items, builds, spell pairs; lib/deepscore.ts), best first.
 *  `fit`: fitted next-patch settings (single items); without it, the old hand-set prior (builds, spell pairs). */
export function scoreRows<T extends { winRate: number; pickRate: number }>(list: T[], fit: Fit | null = null): (T & { deepScore?: number })[] {
  if (!list.length) return list;
  const picks = list.map((r) => r.pickRate).sort((x, y) => x - y);
  const median = picks[Math.floor(picks.length / 2)] || 1;
  const total = list.reduce((s, r) => s + r.pickRate, 0) || 1;
  const mean = list.reduce((s, r) => s + r.winRate * r.pickRate, 0) / total;
  const bounds = list.map((r) =>
    fit
      ? fittedBound(r.winRate, r.pickRate / median, mean, fit)
      : lowerBound(
          r.winRate,
          (r.pickRate / median) * MEDIAN_GAMES,
          mean,
          PRIOR * MEDIAN_GAMES,
        ),
  );
  const grades = grade(bounds);
  return list
    .map((r, i) => ({ ...r, deepScore: grades[i].deepScore }))
    .sort((x, y) => y.deepScore! - x.deepScore! || y.pickRate - x.pickRate);
}

/** The row players should copy: most wins among rows with a real following (2% of games, or the top three). */
export function bestRow<T extends Rated>(rows: T[], min = 0.02): T | null {
  const common = rows.filter((r, i) => r.pickRate >= min || i < 3);
  return common.length
    ? common.reduce((a, r) => (r.winRate > a.winRate ? r : a))
    : null;
}
