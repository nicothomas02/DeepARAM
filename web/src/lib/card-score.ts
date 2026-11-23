import { fittedBound, grade, lowerBound, nextPatch, trueSpread, type Fit } from "./deepscore";
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
  /** Core builds: how many core items come before the boots (from game timelines, data/estimates/boots_slot.json). */
  bootsAt?: number;
  /** Core builds: the rest of the usual six-item build, most built first (lib/build-plan.ts restOfBuild). */
  rest?: number[];
  /** Core builds: the single items to buy after the core, one by one with their own numbers (laterItems). */
  later?: ItemRow[];
  /** The same items split by the slot they're bought in (4th, 5th, 6th legendary), when purchase order is known. */
  slots?: { slot: number; items: ItemRow[] }[];
};

/** A row's items in the order they're bought: the boots go in at bootsAt (after the core when it isn't known). */
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
  // Real games when every row has them (Nico, 2026-11-21: popularity alone shouldn't read as good). Each row's lead
  // over the list is shrunk by its own sampling noise (empirical Bayes: tau2 / (tau2 + v)) and scored on that
  // estimate, with no extra penalty for a smaller sample: once a row has a real following (MIN_FOLLOWING or enough
  // games), the shrunk win rate alone picked rows that led more on the next patch (101 history 16.20-16.23: starters
  // +1.44 pts vs +1.40 with a one-spread penalty, boots +1.71 vs +1.63; Nico, 2026-11-21: weigh win rate a little
  // more, e.g. Guardian's Blade). Without games (estimates), pick rate stands in.
  const games = list.map((r) => (r as { games?: number }).games ?? 0);
  if (games.every((g) => g > 0)) {
    const vs = list.map((r, i) => (r.winRate * (1 - r.winRate)) / games[i]);
    const tau2 = trueSpread(list.map((r) => r.winRate), vs);
    const bounds = list.map((r, i) => {
      if (fit) return nextPatch(r.winRate, 1, mean, fit, { v: vs[i], tau2 }).est;
      const w = tau2 / (tau2 + vs[i]);
      return mean + w * (r.winRate - mean);
    });
    const grades = grade(bounds);
    return list
      .map((r, i) => ({ ...r, deepScore: grades[i].deepScore }))
      .sort((x, y) => y.deepScore! - x.deepScore! || y.pickRate - x.pickRate);
  }
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

/** Below this share of games buying finished boots, a champion can count as skipping them (skipsBoots). */
export const SKIP_BOOTS = 0.25;

/**
 * Whether the champion's card should leave boots out: under SKIP_BOOTS of its games buy finished boots and most of
 * its listed six-item builds have none (Nico, 2026-11-20: a champion that skips boots shows none; Yuumi, Karthus).
 */
export function skipsBoots(boots: { pickRate: number }[], full: { items: number[]; pickRate: number }[], isBoots: (id: number) => boolean): boolean {
  const bought = boots.reduce((s, r) => s + r.pickRate, 0);
  const total = full.reduce((s, r) => s + r.pickRate, 0);
  const without = full.filter((r) => !r.items.some(isBoots)).reduce((s, r) => s + r.pickRate, 0);
  return bought < SKIP_BOOTS && total > 0 && without / total > 0.5;
}

/**
 * Items that fit this core's style: those sharing a shop class (fighter, marksman, mage, tank...) with a core item.
 * Keeps a tank core from being offered mage items for a situation. Rows with no class data are kept.
 */
export function sameStyle<T extends { items: number[] }>(pool: T[], core: number[], classesOf: (id: number) => string[]): T[] {
  const style = new Set(core.flatMap(classesOf));
  if (!style.size) return pool;
  return pool.filter((r) => {
    const c = classesOf(r.items[0]);
    return !c.length || c.some((x) => style.has(x));
  });
}

/** How many situational items the card shows. */
export const SITUATIONAL = 7;

/**
 * Situational items after the core: the situations the champion's items answer (lib/situations.ts), each with up to
 * `per` items in pool order (bought with the core first, then DeepScore), situations in the order of their best item.
 * Items with no situation aren't listed: the card shows the core plus what to swap in for the game you're in
 * (Nico, 2026-11-20: buying the same six items every game isn't practical).
 */
export function situational<T extends { items: number[] }, S extends string>(
  pool: T[],
  situationOf: (id: number) => S | null | undefined,
  n = SITUATIONAL,
  per = 3,
): { situation: S; options: T[] }[] {
  const out = new Map<S, T[]>();
  for (const r of pool) {
    const s = situationOf(r.items[0]);
    if (!s) continue;
    const list = out.get(s);
    if (list) {
      if (list.length < per) list.push(r);
    } else if (out.size < n) out.set(s, [r]);
  }
  return [...out].map(([situation, options]) => ({ situation, options }));
}

/** The row players should copy: most wins among rows with a real following (2% of games, or the top three). */
export function bestRow<T extends Rated>(rows: T[], min = 0.02): T | null {
  const common = rows.filter((r, i) => r.pickRate >= min || i < 3);
  return common.length
    ? common.reduce((a, r) => (r.winRate > a.winRate ? r : a))
    : null;
}

/** How many single items the card lists after the core. */
export const LATER_ITEMS = 5;

/**
 * The items to buy after the core, listed one by one with their own numbers (Nico, 2026-11-23: core, then the rest
 * of the items singly above the situational ones). From a pool already ranked for this core (bought with it first,
 * then DeepScore): the same shop style as the core, not a core item or its boots, those with a real following first.
 */
export function laterItems<T extends ItemRow>(pool: T[], core: ItemRow, classesOf: (id: number) => string[], n = LATER_ITEMS): T[] {
  const skip = new Set([...core.items, ...(core.boots !== undefined ? [core.boots] : [])]);
  return followed(sameStyle(pool.filter((r) => !skip.has(r.items[0])), core.items, classesOf)).slice(0, n);
}

/** Per item id: how many players first bought it as their 1st to 6th legendary (data/estimates/item_slots.json). */
export type SlotCounts = Record<string, number[]>;
/** Champion counts lean on the item's all-champion slot split until they have about this many buys after the core. */
const SLOT_PRIOR = 10;
/** An item is listed in a slot once at least this share of its buys after the core land there. */
const SLOT_SHARE = 0.34;
/** Items per slot. */
export const PER_SLOT = 3;

/**
 * The items after the core split into the 4th, 5th and 6th item slots (Nico, 2026-11-23). Which items and their
 * order (best DeepScore first among followed items) are laterItems' pool; only the slot comes from purchase order.
 * An item is listed in every slot that holds at least SLOT_SHARE of its later buys (the champion's own counts,
 * shrunk to the item's split over all champions). Slots left short fill with the closest remaining items.
 * Null when no item has purchase-order data.
 */
export function slotItems<T extends ItemRow>(
  pool: T[],
  core: ItemRow,
  classesOf: (id: number) => string[],
  champ: SlotCounts | undefined,
  all: SlotCounts | undefined,
  per = PER_SLOT,
): { slot: number; items: T[] }[] | null {
  const first = core.items.length + 1;
  const slots = Array.from({ length: Math.max(0, 7 - first) }, (_, k) => first + k);
  if (!slots.length || !all) return null;
  // Only items with a real following (MIN_FOLLOWING of the most bought one), as for builds: a 1% pick shouldn't fill a
  // slot just because its few buyers bought it 5th.
  const all12 = laterItems(pool, core, classesOf, 12);
  const top = Math.max(0, ...all12.map((r) => r.pickRate));
  const cands = all12.filter((r) => r.pickRate >= MIN_FOLLOWING * top);
  const shares = new Map<number, number[]>();
  for (const r of cands) {
    // Counts are keyed by the base item id; the card may hold the mode's copy (223031 for 3031).
    const id = String(r.items[0] >= 100000 ? r.items[0] % 10000 : r.items[0]);
    const a = slots.map((s) => all[id]?.[s - 1] ?? 0);
    const aTot = a.reduce((t, x) => t + x, 0);
    if (!aTot) continue;
    const c = slots.map((s) => champ?.[id]?.[s - 1] ?? 0);
    const cTot = c.reduce((t, x) => t + x, 0);
    shares.set(r.items[0], c.map((x, k) => (x + (SLOT_PRIOR * a[k]) / aTot) / (cTot + SLOT_PRIOR)));
  }
  if (!shares.size) return null;
  const out = slots.map((slot, k) => ({
    slot,
    items: cands.filter((r) => (shares.get(r.items[0])?.[k] ?? 0) >= SLOT_SHARE).slice(0, per),
  }));
  out.forEach((o, k) => {
    if (o.items.length >= per) return;
    const listed = new Set(o.items.map((r) => r.items[0]));
    const rest = cands
      .filter((r) => shares.has(r.items[0]) && !listed.has(r.items[0]))
      .sort((x, y) => shares.get(y.items[0])![k] - shares.get(x.items[0])![k]);
    o.items = [...o.items, ...rest.slice(0, per - o.items.length)].sort((x, y) => cands.indexOf(x) - cands.indexOf(y));
  });
  return out;
}
