import { fittedBound, grade, lowerBound, nextPatch, trueSpread, type Fit } from "./deepscore";
import type { ItemTier } from "./items";
import { clashWith } from "./item-limits";

// Scoring shared by the champion page's server code (lib/champion-page.ts) and the top card's timeframe picker,
// which re-ranks builds in the browser for the patches picked (components/champion/Timeframe.tsx).

/** games: estimated live-patch games behind winRate (the champion's games × pickRate), for its 95% range. */
/** pooled: the same row with earlier patches pooled in where nothing changed (data/aramhex/common.py pool); DeepScore
 *  ranks on it (scoreRows), the shown win rate stays the live patch's. */
export type Pooled = { winRate: number; games: number; patches: number };
export type Rated = { winRate: number; pickRate: number; lift: number; games?: number; pooled?: Pooled };
export type ItemRow = Rated & {
  items: number[];
  deepScore?: number;
  /** Lead over the list's average in win-rate points (lib/deepscore.ts grade edge), for the badge's hover. */
  deepEdge?: number;
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
  /** `home`: the items whose most common slot this is (each item shows in one slot). */
  slots?: { slot: number; items: ItemRow[]; home?: number[] }[];
  /** The card's full build after the core: one pick per slot, so core, boots and picks make six items. */
  full?: ItemRow[];
  /** Starting items: the augment whose first-screen picks explain most of the start's games (it never leads the card). */
  augment?: number;
  /** Starting items: a boot start from the archived lobbies (data/estimates/boot_starts.json), not from the stats feed. */
  estimated?: boolean;
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
export function scoreRows<T extends { winRate: number; pickRate: number }>(
  given: T[],
  fit: Fit | null = null,
  opts: { bound?: boolean } = {},
): (T & { deepScore?: number; deepEdge?: number })[] {
  if (!given.length) return given;
  // Rows with earlier patches pooled in score on those (Nico 2026-11-23: small samples); the rows returned are the
  // given ones, with their live-patch numbers.
  const list = given.map((r) => {
    const p = (r as { pooled?: Pooled }).pooled;
    return p ? { ...r, winRate: p.winRate, games: p.games } : r;
  });
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
      // bound (Nico 2026-11-23, analysis/scoring/RESULTS.md): rank on the estimate minus one typical miss, as the Tier
      // List does. Rarely picked rows really do win less next patch (augments under 1% of the top row's games: -4 pts),
      // and shrinking toward the list's average flattered them. From random 3-option offers it picked better on
      // first-day data (augments +0.08 pts, spell pairs +0.2 to +0.4) and the same on full data.
      if (fit && opts.bound) return fittedBound(r.winRate, 1, mean, fit, { v: vs[i], tau2 });
      if (fit) return nextPatch(r.winRate, 1, mean, fit, { v: vs[i], tau2 }).est;
      const w = tau2 / (tau2 + vs[i]);
      return mean + w * (r.winRate - mean);
    });
    const grades = grade(bounds);
    return given
      .map((r, i) => ({ ...r, deepScore: grades[i].deepScore, deepEdge: grades[i].edge }))
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
  return given
    .map((r, i) => ({ ...r, deepScore: grades[i].deepScore, deepEdge: grades[i].edge }))
    .sort((x, y) => y.deepScore! - x.deepScore! || y.pickRate - x.pickRate);
}

// Augment lists (2026-11-27, Nico asked to get ahead on ranked lists with one rule for site and apps): each augment's
// lead on this champion is shrunk toward how the same augment leads on the OTHER champions (leave-one-out, itself
// shrunk by its noise), not toward zero, and ranked on the estimate minus half a typical miss. Next-patch replay
// (AramHex 16.19-16.23, 4 transitions, previous patches pooled as the site does, full / 10% / 2% of games), against
// the bound rule it replaces and a 300-game smoothing rule: never worse on random 3-card offers (+0.03 pts per pick
// on 2% of games), ahead on the champion's top-5 list (+0.02 / +0.09 / +0.10 pts vs the bound rule; +0.00 / +0.05 /
// +0.04 vs smoothing). Penalty 0.5 picked
// from 0 / 0.25 / 0.5 / 0.75; 0.25 and 0.75 tell the same story. Correlation, not causation.
const LEAD_VAR_FLOOR = 0.05; // floor on p(1 - p), so a 0% or 100% row still has a variance
export const PRIOR_PENALTY = 0.5;
export type LeadRow = { id: number; winRate: number; pickRate: number; games: number };
/** champion key, augment id -> the augment's lead on the other champions, shrunk (0 when no other champion has it). */
export type AugmentPrior = (champion: string, id: number) => number;

function leadsOf(list: LeadRow[]): { id: number; lead: number; v: number }[] {
  const total = list.reduce((s, r) => s + r.pickRate, 0) || 1;
  const mean = list.reduce((s, r) => s + r.winRate * r.pickRate, 0) / total;
  return list.map((r) => ({ id: r.id, lead: r.winRate - mean, v: Math.max(r.winRate * (1 - r.winRate), LEAD_VAR_FLOOR) / r.games }));
}

/** The cross-champion prior from every champion's augment list (rows with games only). */
export function augmentPrior(lists: Record<string, LeadRow[]>): AugmentPrior {
  const per = Object.entries(lists)
    .filter(([, rows]) => rows.length && rows.every((r) => r.games > 0))
    .map(([c, rows]) => [c, leadsOf(rows)] as const);
  const sum = new Map<number, { w: number; wx: number }>();
  for (const [, rows] of per)
    for (const r of rows) {
      const s = sum.get(r.id) ?? { w: 0, wx: 0 };
      s.w += 1 / r.v;
      s.wx += r.lead / r.v;
      sum.set(r.id, s);
    }
  const raw: { key: string; mu: number; mv: number }[] = [];
  for (const [c, rows] of per)
    for (const r of rows) {
      const s = sum.get(r.id)!;
      const w = s.w - 1 / r.v;
      if (w > 1e-9) raw.push({ key: `${c}:${r.id}`, mu: (s.wx - r.lead / r.v) / w, mv: 1 / w });
    }
  const tau2 = trueSpread(raw.map((r) => r.mu), raw.map((r) => r.mv));
  const out = new Map(raw.map((r) => [r.key, (tau2 / (tau2 + r.mv)) * r.mu]));
  return (champion, id) => out.get(`${champion}:${id}`) ?? 0;
}

/** Each augment's score on this champion, as a win-rate lead (fraction): the lead shrunk toward the prior `mu`, times
 *  the fit's carry-over, minus PRIOR_PENALTY of its typical miss beyond the miss every row shares. Empty when any row
 *  lacks games. The champion page grades these into DeepScore and the apps add synergy points on the same scale. */
export function priorLeads(list: LeadRow[], mu: (id: number) => number, fit: Fit, penalty = PRIOR_PENALTY): Map<number, number> {
  if (!list.length || !list.every((r) => r.games > 0)) return new Map();
  const ls = leadsOf(list);
  const dev = ls.map((r) => r.lead - mu(r.id));
  const tau2 = trueSpread(dev, ls.map((r) => r.v));
  return new Map(
    ls.map((r, i) => {
      const k = tau2 / (tau2 + r.v);
      const post = mu(r.id) + k * dev[i];
      const miss = Math.sqrt(fit.s0 ** 2 + k * r.v) - fit.s0;
      return [r.id, fit.b * post - penalty * miss];
    }),
  );
}

/** Share of the most common row's pick rate a row needs to lead a list (FOLLOWED). */
export const MIN_FOLLOWING = 0.25;
/**
 * Real games a row needs to lead an item, boots, spell-pair or core list (Nico chose 2026-11-24, "maybe consider flat
 * sample size minimum instead of percentage requirement"), counted as the games its DeepScore stands on (pooled where
 * earlier patches are pooled in). Next-patch backtest (analysis/scoring/following_sweep.py, bound rule) of the card's
 * top row vs 25% of the top row's games: items +2.5 pts (5%: +1.0), boots +1.6 (5%: +1.1), spell pairs +1.0 (2%: +0.2),
 * cores +0.4; on data thinned to 10%, items +1.7, boots +1.2, spells +0.2, cores +0.2. When no row has that many, the
 * most played one leads, as in the backtest. Lists without real game counts keep the share rules below.
 */
export const MIN_GAMES = 1000;
/**
 * Spell pairs lead from fewer games (Nico chose 2026-11-24, "Spells to 100, rest stay"). Same backtest, 16.21-16.23,
 * 321 champion-patches, card's top pair vs 1,000 games: 100 games +0.74 pts next patch on full data, +0.30 on data
 * thinned to 10% (250: +0.68 / +0.03; 500: +0.38 / -0.06; no minimum hurt early, -0.19). Items, boots, cores and
 * starters gained nothing measurable below 1,000, so they keep it.
 */
export const SPELL_MIN_GAMES = 100;
/** Fallback share for single items and boots without real game counts (Nico chose 5% on 2026-11-24). */
export const ITEM_FOLLOWING = 0.05;
/** Fallback share for spell pairs without real game counts (Nico chose 2% on 2026-11-24). */
export const SPELL_FOLLOWING = 0.02;

/** Flash's summoner spell id. */
export const FLASH = 4;
/** A spell pair without Flash that well under a quarter of the most-taken pair's players take (Nico 2026-11-24,
 *  Yunara's Ghost + Barrier): it may lead, but the card tags it "Few players" with its pick rate so the risk shows. */
export function fewPlayersSpell<T extends { pickRate: number; spells: { id: number }[]; estimated?: boolean }>(
  r: T,
  rows: T[],
  share = 0.25,
): boolean {
  if (r.estimated || r.spells.some((s) => s.id === FLASH)) return false;
  const top = Math.max(0, ...rows.map((x) => x.pickRate));
  return top > 0 && r.pickRate < share * top;
}

/** The real games behind a row's DeepScore: pooled where earlier patches are pooled in, else the live patch's. */
export const gamesOf = (r: { games?: number; pooled?: Pooled }): number | undefined => r.pooled?.games ?? r.games;

/**
 * Which rows of a list may lead it: with real game counts on every row, those with minGames (else only the most
 * played); otherwise those with `share` of the most common row's pick rate.
 */
export function canLead<T extends { pickRate: number; games?: number; pooled?: Pooled }>(
  rows: T[],
  share: number,
  minGames = MIN_GAMES,
): (r: T) => boolean {
  if (rows.length && rows.every((r) => (gamesOf(r) ?? 0) > 0)) {
    if (rows.some((r) => gamesOf(r)! >= minGames)) return (r) => gamesOf(r)! >= minGames;
    const most = rows.reduce((a, b) => (gamesOf(b)! > gamesOf(a)! ? b : a));
    return (r) => r === most;
  }
  const top = Math.max(0, ...rows.map((r) => r.pickRate));
  return (r) => r.pickRate >= share * top;
}

/** The same rows with those that may lead first (canLead), each group keeping its order. */
export function leading<T extends { pickRate: number; games?: number; pooled?: Pooled }>(
  rows: T[],
  share: number,
  minGames = MIN_GAMES,
): T[] {
  const ok = canLead(rows, share, minGames);
  return [...rows.filter(ok), ...rows.filter((r) => !ok(r))];
}

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
export function skipsBoots(boots: { pickRate: number }[], full: { items: number[]; pickRate: number }[], isBoots: (id: number) => boolean, better = false): boolean {
  // Never buying boots tested better for this champion (data/estimates/no_boots.json; none pass yet, Nico 2026-11-27).
  if (better) return true;
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
  return leading(sameStyle(pool.filter((r) => !skip.has(r.items[0])), core.items, classesOf), ITEM_FOLLOWING).slice(0, n);
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
): { slot: number; items: T[]; home: number[] }[] | null {
  const first = core.items.length + 1;
  const slots = Array.from({ length: Math.max(0, 7 - first) }, (_, k) => first + k);
  if (!slots.length || !all) return null;
  // Only items that may lead (canLead: MIN_GAMES real games), as for builds: an item bought in a handful of games
  // shouldn't fill a slot just because its few buyers bought it 5th.
  const all12 = laterItems(pool, core, classesOf, 12);
  const cands = all12.filter(canLead(all12, ITEM_FOLLOWING));
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
  // Each item's home: the listed slot where the largest share of its buyers buy it (the earlier on a tie), so the card
  // can show an option once instead of in every slot it's listed in (Nico 2026-11-24: "don't show item in path twice").
  const homeOf = new Map<number, number>();
  out.forEach((o, k) =>
    o.items.forEach((r) => {
      const h = homeOf.get(r.items[0]);
      if (h === undefined || shares.get(r.items[0])![k] > shares.get(r.items[0])![h]) homeOf.set(r.items[0], k);
    }),
  );
  return out.map((o, k) => ({ ...o, home: o.items.filter((r) => homeOf.get(r.items[0]) === k).map((r) => r.items[0]) }));
}

/**
 * One full build (Nico, 2026-11-23: "all items in build displayed", picked so they work together): after the core and
 * boots, the best DeepScore item of each slot's list (followed, same style as the core), each item used once, until
 * the build holds six items. A slot with nothing left takes the best remaining item after the core.
 */
export function fullPicks<T extends ItemRow>(core: ItemRow, slots: { slot: number; items: T[] }[] | undefined, later: T[] | undefined, size = 6): T[] {
  const room = Math.max(0, size - core.items.length - (core.boots !== undefined ? 1 : 0));
  const out: T[] = [];
  // never two items the game won't let you own together (lib/item-limits.ts)
  const taken = (r: T) => out.some((o) => o.items[0] === r.items[0]) || clashWith(r.items[0], [...core.items, ...out.map((o) => o.items[0])]) !== undefined;
  const best = (rows: T[]) => [...rows].filter((r) => !taken(r)).sort((a, b) => (b.deepScore ?? 0) - (a.deepScore ?? 0))[0];
  for (let k = 0; k < room; k++) {
    const pick = best(slots?.[k]?.items ?? []) ?? best(later ?? []);
    if (pick) out.push(pick);
  }
  return out;
}

/**
 * The card's full build from a real six-item build (assumptions audit, 2026-11-23): the best DeepScore build with a
 * following (MIN_FOLLOWING of the most common one) that holds the core; its other non-boots items, in buying-slot
 * order, as rows from `single`. Null when no such build exists, and the card falls back to fullPicks. Tested on all
 * 173 champions: the per-slot path was a real build for only 66 (and won 2.0 pts less than the best followed real
 * build where it was); this one is a real build (boots aside) for 148, and a followed build holds the core for 165.
 */
export function realFullPicks<T extends ItemRow>(
  core: ItemRow,
  builds: ItemRow[],
  single: T[],
  slots: { slot: number; items: ItemRow[] }[] | undefined,
  isBoots: (id: number) => boolean,
  size = 6,
): T[] | null {
  const n = (i: number) => (i >= 100000 ? i % 10000 : i);
  const holds = (r: ItemRow, ids: number[]) => ids.every((i) => r.items.some((j) => n(j) === n(i)));
  const top = Math.max(0, ...builds.map((r) => r.pickRate));
  const fol = builds.filter((r) => r.items.length >= size && r.pickRate >= MIN_FOLLOWING * top);
  const byScore = (a: ItemRow, b: ItemRow) => (b.deepScore ?? 0) - (a.deepScore ?? 0);
  const pick = fol.filter((r) => holds(r, core.items)).sort(byScore)[0];
  if (!pick) return null;
  const room = Math.max(0, size - core.items.length - (core.boots !== undefined ? 1 : 0));
  const slotOf = (i: number) => {
    const k = slots?.findIndex((s) => s.items.some((r) => n(r.items[0]) === n(i))) ?? -1;
    return k < 0 ? 99 : k;
  };
  return pick.items
    .filter((i) => !core.items.some((c) => n(c) === n(i)) && !isBoots(i))
    .sort((a, b) => slotOf(a) - slotOf(b))
    .slice(0, room)
    .map((i) => single.find((r) => r.items.length === 1 && n(r.items[0]) === n(i)) ?? ({ items: [i], winRate: NaN, pickRate: 0, lift: 0 } as unknown as T));
}

/** Below this many sampling SEs, a list's lead over the next row is a "Close call" (research/confidence/lead_holds.py,
 *  2026-11-27: AramHex 16.19-16.23 champion lists, leads under 1 SE stayed on top next patch 35-57% of the time, leads
 *  of 2+ SE 85-93%). */
export const CLOSE_CALL_Z = 1;
const CLOSE_MIN_GAMES = 100;

/** Whether `rows[0]`'s lead over the next row with real games is too small to count on (CLOSE_CALL_Z): both win rates
 *  shrunk by their own sampling noise (as scoreRows does), gap over the gap's sampling SE. Pooled numbers when a row has
 *  them. False when rows lack real games (estimates). */
export function closeCall<T extends { winRate: number; games?: number; pooled?: Pooled }>(rows: T[]): boolean {
  const use = rows
    .map((r) => (r.pooled ? { w: r.pooled.winRate, g: r.pooled.games } : { w: r.winRate, g: r.games ?? 0 }))
    .filter((r) => Number.isFinite(r.w));
  if (use.length < 2 || use[0].g < CLOSE_MIN_GAMES) return false;
  const real = use.filter((r) => r.g >= CLOSE_MIN_GAMES);
  if (real.length < 2) return false;
  const vs = real.map((r) => (r.w * (1 - r.w)) / r.g);
  const tau2 = trueSpread(real.map((r) => r.w), vs);
  const mean = real.reduce((s, r) => s + r.w, 0) / real.length;
  const est = real.map((r, i) => mean + (tau2 / (tau2 + vs[i])) * (r.w - mean));
  const z = (est[0] - est[1]) / Math.sqrt(vs[0] + vs[1]);
  return z < CLOSE_CALL_Z;
}
