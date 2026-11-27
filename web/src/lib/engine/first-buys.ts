// Natural buy order from the archive (data/estimates/item_slots.json: the legendary slot each of 12,000 archived players
// first bought each item in, all champions). One list for the site card and the apps' path, so they can't drift; a unit
// test keeps both sets in step with the file.

/** Bought as the first legendary by 80%+ of their 400+ buyers: Heartsteel 93%, Yun Tal 84%, Rod of Ages 83%, Hubris 82%,
 *  Luden's 81%. They lead the path (Nico 2026-11-27, Briar's Hubris). */
export const FIRST_BUYS = new Set([3084, 3032, 6657, 6697, 6655]);

/** Bought as the 1st or 2nd legendary by 5% or less of their 100+ buyers: penetration and late picks (Void Staff 2.6%,
 *  Serylda's 3.4%, Terminus, Cryptbloom, Mortal Reminder, Bloodletter's, Bloodthirster, Banshee's, Morellonomicon).
 *  AramHex's ordered cores agree: Void Staff, Serylda's and Mortal Reminder are the 3rd item in every core that holds
 *  them. They come after the first two legendaries (Nico 2026-11-27, Shaco's Void Staff 2nd). */
export const LATE_BUYS = new Set([3033, 3072, 3102, 3135, 3137, 3165, 3302, 6694, 8010]);

/** Mayhem copies (223031) count as the item (3031). */
const base = (id: number) => (id >= 100000 ? id % 10000 : id);

/** The list with its first-buy item (the first one, if several) moved to the front; the rest keep their order. */
export function firstBuyOrder(ids: number[]): number[] {
  const j = ids.findIndex((i) => FIRST_BUYS.has(base(i)));
  return j > 0 ? [ids[j], ...ids.filter((_, n) => n !== j)] : ids;
}

/** Late buys among the first `slots` legendaries move behind the next ones that aren't late; boots keep their places
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

/** The card's six items in buying order: late buys after the first two legendaries, then a first-buy item first. */
export function cardBuyOrder(ids: number[], isBoots: (id: number) => boolean): number[] {
  return firstBuyOrder(lateBuyOrder(ids, (i) => i, isBoots));
}
