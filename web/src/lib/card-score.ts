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

/** Share of the most common row's pick rate a row needs to lead a list (FOLLOWED). */
export const MIN_FOLLOWING = 0.25;

/**
 * The same rows with those that have a real following first (at least MIN_FOLLOWING of the most common row's pick
 * rate), each group keeping its order. Builds are cut from the six-item builds players finish, so a build taken in
 * 0.5% of games often shows a high win rate from a handful of long or lucky games; it stays in the list but can't
 * lead it (Nico, 2026-11-20: the card showed rare builds over the strong common ones, e.g. AP over tank Alistar).
 */
export function followed<T extends { pickRate: number }>(rows: T[], share = MIN_FOLLOWING): T[] {
  const top = Math.max(0, ...rows.map((r) => r.pickRate));
  const ok = (r: T) => r.pickRate >= share * top;
  return [...rows.filter(ok), ...rows.filter((r) => !ok(r))];
}

/**
 * Single items with those bought alongside this core first: items in the six-item builds that share at least two
 * of its three items, each group keeping its order. Without it a tank core could be followed by mage items that
 * only the champion's AP players buy (Nico, 2026-11-20: make every champion's card read like a real build).
 */
export function alongCore<T extends { items: number[] }>(pool: T[], core: number[], full: { items: number[] }[]): T[] {
  const along = new Set<number>();
  for (const f of full) if (core.filter((i) => f.items.includes(i)).length >= Math.min(2, core.length)) f.items.forEach((i) => along.add(i));
  if (!along.size) return pool;
  const ok = (r: T) => along.has(r.items[0]);
  return [...pool.filter(ok), ...pool.filter((r) => !ok(r))];
}

/** The row players should copy: most wins among rows with a real following (2% of games, or the top three). */
export function bestRow<T extends Rated>(rows: T[], min = 0.02): T | null {
  const common = rows.filter((r, i) => r.pickRate >= min || i < 3);
  return common.length
    ? common.reduce((a, r) => (r.winRate > a.winRate ? r : a))
    : null;
}
