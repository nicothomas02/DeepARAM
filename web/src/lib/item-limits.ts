import limitsData from "@/data/item-limits.json";

// The game's own "you can own only one of these" rules (Nico 2026-11-23): Lord Dominik's, Mortal Reminder, Serylda's,
// Terminus and Black Cleaver share the Last Whisper group; Sterak's, Maw and Shieldbow share Lifeline; Void Staff,
// Cryptbloom, Terminus and Bloodletter's share Void pen; the Hydras, Immolate items, Spellblade items, Quicksilver...
// From the client's item data (web/scripts/fetch_item_groups.py writes data/item-limits.json). A build never holds
// two items of one group, and a situational item that clashes with a build item replaces it instead of adding.
// Pure, so the shared build engine (lib/engine) uses the same rule.

export type ItemLimit = { group: string; max: number; items: number[] };

/** Mayhem's copies of an item (223031) and the plain item (3031) are the same item for these rules. */
const base = (id: number) => (id >= 100000 ? id % 10000 : id);

/**
 * Groups the archive shows players holding two of at once in Mayhem (2026-11-23, every player of 1,245 archived games,
 * purchases minus sells): Sunfire Aegis with Hollow Radiance (88 players) and two Hydras (90, mostly with the Ultra
 * Hydra augment). Mayhem's augments lift these, so they aren't enforced. Every other group: no player ever held two,
 * and none of 101's 1,730 public full builds holds two.
 */
export const UNENFORCED = new Set(["ImmolateItems", "CleaveItems"]);

export function limitIndex(limits: ItemLimit[] = limitsData as ItemLimit[]): Map<number, number[]> {
  const byItem = new Map<number, number[]>();
  limits.forEach((g, k) => {
    if (UNENFORCED.has(g.group)) return;
    // Boots are one slot anyway; components (Sheen, Tear) build into their group's finished items, so only finished
    // items clash in practice and the rule is applied to whatever the build lists.
    for (const id of g.items) byItem.set(base(id), [...(byItem.get(base(id)) ?? []), k]);
  });
  return byItem;
}

const DEFAULT = limitIndex();

/** Whether two different items can't be owned together. */
export function clashes(a: number, b: number, index = DEFAULT): boolean {
  if (base(a) === base(b)) return false;
  const ga = index.get(base(a));
  if (!ga) return false;
  const gb = index.get(base(b)) ?? [];
  return ga.some((g) => gb.includes(g));
}

/** The first item of `owned` that `id` can't be owned with, if any. */
export function clashWith(id: number, owned: Iterable<number>, index = DEFAULT): number | undefined {
  for (const o of owned) if (clashes(id, o, index)) return o;
  return undefined;
}

/** The list with every item that clashes with `keep` or with an earlier item of the list left out. */
export function withoutClashes(ids: number[], keep: number[] = [], index = DEFAULT): number[] {
  const out: number[] = [];
  for (const i of ids) if (clashWith(i, [...keep, ...out], index) === undefined) out.push(i);
  return out;
}
