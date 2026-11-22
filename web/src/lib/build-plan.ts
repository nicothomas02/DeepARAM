// The champion card's build plan, beyond the core and situational items (Nico, 2026-11-20, layout pass):
// - the components to rush for the first core item,
// - augment-aware swaps: when an augment the champion takes upgrades an item, buy that item first,
// - build styles: a tab per real style when a champion has two (tank and AP Alistar),
// - "Tied": options whose win rates are within noise of the best one.
// Pure and generic: every rule reads item and augment data, never a hand-kept champion list.

/** Shop classes folded into the styles a player picks between: ability power, attack damage, tank, support. */
const STYLE_OF: Record<string, string> = { mage: "ap", marksman: "ad", assassin: "ad", fighter: "ad", tank: "tank", support: "support" };
const STYLE_ORDER = ["tank", "ap", "ad", "support"];

/** A build's style: the one most of its items' shop classes point to (ap, ad, tank, support). */
export function buildStyle(items: number[], classesOf: (id: number) => string[]): string | null {
  const n = new Map<string, number>();
  for (const i of items) for (const s of new Set(classesOf(i).map((c) => STYLE_OF[c]).filter(Boolean))) n.set(s, (n.get(s) ?? 0) + 1);
  const best = [...n].sort((x, y) => y[1] - x[1] || STYLE_ORDER.indexOf(x[0]) - STYLE_ORDER.indexOf(y[0]))[0];
  return best ? best[0] : null;
}

/**
 * The best core of each style, in list order, when the champion has at least two real styles: another style counts
 * when its best core has at least `share` of the most common core's pick rate. Empty for one-style champions.
 */
export function styleCores<T extends { items: number[]; pickRate: number }>(
  cores: T[],
  classesOf: (id: number) => string[],
  share = 0.25,
  max = 2,
): { style: string; core: T }[] {
  const top = Math.max(0, ...cores.map((r) => r.pickRate));
  const out: { style: string; core: T }[] = [];
  for (const r of cores) {
    if (r.pickRate < share * top) continue;
    const s = buildStyle(r.items, classesOf);
    if (!s || out.some((o) => o.style === s)) continue;
    out.push({ style: s, core: r });
    if (out.length >= max) break;
  }
  return out.length > 1 ? out : [];
}

/** The components to rush for an item: its priciest one or two parts, most expensive first. */
export function rushParts(item: number, recipe: (id: number) => { from?: number[]; price?: number } | undefined, n = 2): number[] {
  const parts = [...new Set(recipe(item)?.from ?? [])];
  return parts
    .map((p) => ({ p, price: recipe(p)?.price ?? 0 }))
    .sort((x, y) => y.price - x.price)
    .slice(0, n)
    .map((x) => x.p);
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Augments that upgrade an item ("Upgrade Infinity Edge", "Upgrade: Deathfire Grasp") matched to an item this
 * champion builds: with that augment, buy the item first. `items` are the champion's legendary items with names,
 * core items first; augments come in the champion's pick order.
 */
export function upgradeSwaps(
  augments: { id: number; name: string; pickRate: number }[],
  items: { id: number; name: string }[],
  n = 3,
): { augment: number; item: number }[] {
  const out: { augment: number; item: number }[] = [];
  for (const a of augments) {
    const m = /^Upgrade:?\s+(.+)$/i.exec(a.name);
    if (!m) continue;
    const want = norm(m[1]);
    const hit = items.find((i) => norm(i.name) === want || norm(i.name).startsWith(want) || norm(i.name) === "the" + want);
    if (hit && !out.some((o) => o.item === hit.id)) out.push({ augment: a.id, item: hit.id });
    if (out.length >= n) break;
  }
  return out;
}

/** Whether a row's win rate is within noise (95%) of the best row's, given each row's games. */
export function tiedWith(best: { winRate: number; games?: number }, r: { winRate: number; games?: number }): boolean {
  if (!best.games || !r.games) return false;
  const p = (best.winRate + r.winRate) / 2;
  const se = Math.sqrt(p * (1 - p) * (1 / best.games + 1 / r.games));
  return Math.abs(best.winRate - r.winRate) < 1.96 * se;
}

/**
 * Whether a starting buy agrees with the build (Nico, 2026-11-20: a Cloak and Tome start means a Rite of Ruin rush).
 * Every bought part must build into a core item or the boots, or be a standalone starter (Doran's, Tear, Dark Seal),
 * or a consumable.
 */
export function starterFits(
  starter: number[],
  build: number[],
  partsOf: (id: number) => number[],
  standalone: (id: number) => boolean,
): boolean {
  const parts = new Set(build.flatMap(partsOf));
  return starter.every((i) => parts.has(i) || build.includes(i) || standalone(i));
}

/**
 * The core with the item the starting buy is clearly heading for first: when two or more of the starter's parts
 * (standalone starters aside) all go into one core item and no other holds them all (Cloak + Tome: Rite of Ruin).
 * A single shared part (a Long Sword) says nothing about the order, so the core keeps its order then.
 */
export function startFirst(core: number[], starter: number[], partsOf: (id: number) => number[], standalone: (id: number) => boolean = () => false): number[] {
  const want = starter.filter((s) => !standalone(s));
  if (want.length < 2) return core;
  const holds = core.filter((i) => {
    const parts = new Set(partsOf(i));
    return want.every((s) => parts.has(s));
  });
  return holds.length === 1 ? [holds[0], ...core.filter((i) => i !== holds[0])] : core;
}

/** A row that lists items in the order players bought them, weighted by how often it's played. */
export type OrderedRow = { items: number[]; weight: number };

/**
 * The core in the order players buy it (Nico, 2026-11-20: items in order of purchase), from rows that list a core in
 * buying order. Each pair of items goes the way most rows holding both put it, and items are sorted by how many
 * others they come before; pairs no row holds count for neither, and ties keep the given order (the caller passes the
 * core already opened by its starting items). `known`: whether any pair had a vote.
 */
export function buyingOrder(core: number[], ordered: OrderedRow[]): { items: number[]; known: boolean } {
  const before = new Map<string, number>();
  for (const r of ordered)
    for (let a = 0; a < r.items.length; a++)
      for (let b = a + 1; b < r.items.length; b++) {
        const k = `${r.items[a]},${r.items[b]}`;
        before.set(k, (before.get(k) ?? 0) + r.weight);
      }
  const vote = (x: number, y: number) => (before.get(`${x},${y}`) ?? 0) - (before.get(`${y},${x}`) ?? 0);
  const pairs = core.flatMap((x, i) => core.slice(i + 1).map((y) => [x, y] as const));
  if (!pairs.some(([x, y]) => before.has(`${x},${y}`) || before.has(`${y},${x}`))) return { items: core, known: false };
  const wins = new Map(core.map((x) => [x, core.reduce((s, y) => s + (x !== y ? Math.sign(vote(x, y)) : 0), 0)]));
  return { items: core.map((x, i) => [x, i] as const).sort((p, q) => wins.get(q[0])! - wins.get(p[0])! || p[1] - q[1]).map(([x]) => x), known: true };
}

/**
 * The rest of the usual six-item build after a core (Nico, 2026-11-20: show the rest of the build above situational
 * items): the items most often bought with this core in six-item builds, most built first, filling the slots the core
 * and boots leave. Builds holding the whole core count first; slots they leave empty fill from builds sharing two
 * core items.
 */
export function restOfBuild(core: number[], boots: number | undefined, full: { items: number[]; pickRate: number }[], isBoots: (id: number) => boolean, slots = 6): number[] {
  const need = slots - core.length - (boots !== undefined ? 1 : 0);
  if (need <= 0) return [];
  const holding = (k: number) => full.filter((f) => core.filter((i) => f.items.includes(i)).length >= k);
  const ranked = (rows: { items: number[]; pickRate: number }[], skip: number[]) => {
    const share = new Map<number, number>();
    for (const f of rows) for (const i of new Set(f.items)) if (!core.includes(i) && !skip.includes(i) && !isBoots(i)) share.set(i, (share.get(i) ?? 0) + f.pickRate);
    return [...share].sort((x, y) => y[1] - x[1] || x[0] - y[0]).map(([i]) => i);
  };
  // Builds holding the whole core first; when they don't name enough later items (few full builds hold all of it),
  // fill the remaining slots from builds holding most of the core, so the build reaches six without leaving its style.
  const out: number[] = [];
  for (const rows of [holding(core.length), holding(Math.min(2, core.length))]) {
    if (out.length >= need) break;
    out.push(...ranked(rows, out).slice(0, need - out.length));
  }
  return out;
}
