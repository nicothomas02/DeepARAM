// Buy order from what an item does (Nico 2026-11-27: find the reason behind an order and extrapolate, no per-item rules).
// One list for the site card and the apps' path, so they can't drift. Unit tests derive both sets from the item text
// (Data Dragon) and check them against the archive buy order (data/estimates/item_slots.json).

/** Items that grow while you hold them (item text: Heartsteel's max health, Yun Tal's permanent crit, Rod of Ages'
 *  stats every minute, Hubris's takedown stacks). Each minute held earlier is more value, so they come first. The archive
 *  agrees: 82-93% of their buyers make each one their first legendary (Nico 2026-11-27, Briar's Hubris). Tear items
 *  stack too but have their own rule (one stacking at a time). */
export const FIRST_BUYS = new Set([3084, 3032, 6657, 6697]);

/** Items with % armor or magic penetration (item text): penetration multiplies damage you already deal against resist
 *  the enemy has already built, so it pays after the items that bring the damage. The archive agrees on all six:
 *  1-10% of buyers take them 1st or 2nd (Void Staff 2.6%, Lord Dominik's 9.3%), and within the same slot players take
 *  them earlier when the enemy has more resist (archive frames, z +1.7 to +5.9) and when they already have more of the
 *  damage stat (Void Staff z +3.0, Lord Dominik's z +3.4). AramHex's ordered cores put them 3rd (Lord Dominik's 95%).
 *  They come after the first two legendaries (Nico 2026-11-27, Shaco's Void Staff 2nd). */
export const LATE_BUYS = new Set([3033, 3036, 3135, 3137, 3302, 6694]);

/** Mayhem copies (223031) count as the item (3031). */
const base = (id: number) => (id >= 100000 ? id % 10000 : id);

/** The list with its first-buy item (the first one, if several) moved to the front; the rest keep their order. */
export function firstBuyOrder(ids: number[]): number[] {
  const j = ids.findIndex((i) => FIRST_BUYS.has(base(i)));
  return j > 0 ? [ids[j], ...ids.filter((_, n) => n !== j)] : ids;
}

/** Penetration items among the first `slots` legendaries move behind the next ones that aren't late; boots keep their places
 *  and items in `fixed` stay put. */
export function lateBuyOrder<T>(list: T[], id: (x: T) => number, isBoots: (x: T) => boolean, slots = 2, fixed: (x: T) => boolean = () => false): T[] {
  const open = list.map((x, i) => (isBoots(x) || fixed(x) ? -1 : i)).filter((i) => i >= 0);
  const seq = open.map((i) => list[i]);
  const out: T[] = [];
  const held: T[] = [];
  for (const x of seq) {
    if (out.length < slots && LATE_BUYS.has(base(id(x)))) { held.push(x); continue; }
    out.push(x);
    if (out.length >= slots && held.length) { out.push(...held); held.length = 0; }
  }
  out.push(...held);
  const res = [...list];
  open.forEach((i, n) => { res[i] = out[n]; });
  return res;
}

/** The card's six items in buying order: penetration after the first two legendaries, then a growing item first. */
export function cardBuyOrder(ids: number[], isBoots: (id: number) => boolean): number[] {
  return firstBuyOrder(lateBuyOrder(ids, (i) => i, isBoots));
}
