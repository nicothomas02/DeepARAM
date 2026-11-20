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
