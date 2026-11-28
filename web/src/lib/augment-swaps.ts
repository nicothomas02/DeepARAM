// Augment-triggered item swaps for the champion card (server only: it reads the build engine's augment -> item
// patterns, which would pull the whole engine into the browser if it sat in lib/build-plan.ts with the card helpers).
import { AUGMENT_ITEMS, augmentItemWhy } from "./engine/build-engine";
import { upgradeSwaps } from "./build-plan";

/** An item to swap in once you've taken one of these augments (Nico, 2026-11-23: situational items that rely on
 *  augments). Rule-based tips, not measured effects. */
export type AugmentSwap = { augments: number[]; item: number; kind: "upgrade" | "style"; why: string };

/** Augments that may change what a champion should build, and the item roles they would favour (unmeasured: shown
 *  only once listed in MEASURED_CHANGERS) (the same list as
 *  data/estimates/augment_builds.py BUILD_CHANGERS). Roles are simulator/data/items.json item roles. */
export const BUILD_CHANGERS: { ids: number[]; roles: string[]; why: string }[] = [
  { ids: [1029, 29], roles: ["onhit", "ap_onhit"], why: "Your abilities apply on-hit effects, so on-hit items pay off more." },
  { ids: [1205, 205], roles: ["ap", "ap_onhit", "ap_tank"], why: "It turns your bonus Attack Damage into Ability Power, so Ability Power items stack with it." },
  { ids: [1206, 206], roles: ["ad", "bruiser", "ability_ad", "crit", "lethality"], why: "It turns your Ability Power into bonus Attack Damage, so Attack Damage items stack with it." },
  { ids: [3049], roles: ["tank", "ap_tank"], why: "Its empowered attack scales with bonus armor." },
  { ids: [1324], roles: ["tank", "ap_tank", "support"], why: "It turns bonus armor and magic resist into heal and shield power." },
];

/** BUILD_CHANGERS augments whose tip the data confirmed (item share with vs without the augment). */
export const MEASURED_CHANGERS = new Set<number>([
  // Ethereal Weapon: 56.2% of holders end with an on-hit item vs 24.4% on the same champions without it (+25.9 pts,
  // per-champion weighted; owner's archived lobbies, all ten players, 2026-11-23). ADAPt, escAPADe, Armored Impact
  // and Protein Shake only moved their roles 5-7 pts on already-high shares, so they stay off as role tips.
  1029, 29,
]);

/** Augments that pull in one specific item: the 30 follow patterns confirmed in the owner's archived lobbies (all ten
 *  players; data/augment-items.json, research/why-best section 2). Holders build the item far more often than the
 *  same champions without the augment, mostly after taking it. Nico 2026-11-23: these are the only augment -> item
 *  tips; payoff words only where a gain was measured (Steel Your Heart -> Bloodmail, Apex Inventor -> Unending
 *  Despair). What players do with the augment, not a win effect. Shared with the build engine (lib/engine). */
export const ITEM_CHANGERS: { ids: number[]; item: number; rate: number; why: string }[] = AUGMENT_ITEMS.map((p) => ({
  // Some augments also carry a short id (Draw Your Sword 1134 and 134).
  ids: p.augment >= 1000 && p.augment < 2000 ? [p.augment, p.augment - 1000] : [p.augment],
  item: p.item,
  rate: p.rate,
  why: augmentItemWhy(p),
}));

/**
 * Augment-triggered swaps for one core: "Upgrade X" augments the champion takes point to item X, and build-changing
 * augments in its pool point to its best DeepScore item of the roles they favour, among items players really build
 * on it with a following (a quarter of the most built one of those roles). Items already in the build are skipped, and
 * so is an augment whose roles the build already has (two or more of its items): ADAPt on a mage changes nothing.
 * Upgrade tips only name items in the build or its style (upgradeIds).
 */
export function augmentSwaps(
  augments: { id: number; name: string; pickRate: number }[],
  build: number[],
  pool: { items: number[]; pickRate: number; deepScore?: number }[],
  rolesOf: (id: number) => string[],
  nameOf: (id: number) => string | undefined,
  upgradeIds: number[],
): AugmentSwap[] {
  const out: AugmentSwap[] = [];
  const has = new Set(build);
  const byPick = [...augments].sort((x, y) => y.pickRate - x.pickRate);
  const candidates = upgradeIds.flatMap((i) => (nameOf(i) ? [{ id: i, name: nameOf(i)! }] : []));
  for (const u of upgradeSwaps(byPick, candidates, 3)) out.push({ augments: [u.augment], item: u.item, kind: "upgrade", why: "The augment upgrades this item." });
  const own = new Set(augments.map((a) => a.id));
  // Role-based changers stay off until each is measured on real games (Nico 2026-11-23: no tips from assumptions
  // without data or his approval). MEASURED lists the ones the data backs; none yet.
  for (const c of BUILD_CHANGERS.filter((x) => x.ids.some((i) => MEASURED_CHANGERS.has(i)))) {
    const ids = c.ids.filter((i) => own.has(i));
    if (!ids.length || build.filter((i) => rolesOf(i).some((x) => c.roles.includes(x))).length >= 2) continue;
    const fit = pool.filter((r) => rolesOf(r.items[0]).some((x) => c.roles.includes(x)));
    const top = Math.max(0, ...fit.map((r) => r.pickRate));
    const pick = fit
      .filter((r) => r.pickRate >= 0.25 * top && !has.has(r.items[0]))
      .sort((a, b) => (b.deepScore ?? 0) - (a.deepScore ?? 0))[0];
    if (pick && !out.some((o) => o.item === pick.items[0])) out.push({ augments: ids, item: pick.items[0], kind: "style", why: c.why });
  }
  // One item per augment: its most followed one the build doesn't already hold. The tip's share comes from all
  // champions, so it only shows where this champion's own games can hold it: at least `rate` of the augment's takers
  // could have built the item (item pick rate >= rate x augment pick rate). Aurora takes Jeweled Gauntlet in 12% of
  // games but builds Infinity Edge in 0.9%, so "40% of players build Infinity Edge" can't be true on her (champion
  // review 2026-11-24, reviews/champion-review-tracker.md G3).
  const base = (i: number) => (i >= 100000 ? i % 10000 : i);
  const itemPick = new Map<number, number>();
  for (const r of pool) itemPick.set(base(r.items[0]), Math.max(itemPick.get(base(r.items[0])) ?? 0, r.pickRate));
  const augPick = new Map(augments.map((a) => [a.id, a.pickRate]));
  const holds = (c: (typeof ITEM_CHANGERS)[number], ids: number[]) =>
    (itemPick.get(base(c.item)) ?? 0) >= c.rate * Math.max(...ids.map((i) => augPick.get(i) ?? 0));
  const tipped = new Set<number>();
  for (const c of [...ITEM_CHANGERS].sort((x, y) => y.rate - x.rate)) {
    const ids = c.ids.filter((i) => own.has(i));
    if (ids.length && !tipped.has(ids[0]) && !has.has(c.item) && nameOf(c.item) && !out.some((o) => o.item === c.item) && holds(c, ids)) {
      out.push({ augments: ids, item: c.item, kind: "style", why: c.why });
      tipped.add(ids[0]);
    }
  }
  return out;
}
