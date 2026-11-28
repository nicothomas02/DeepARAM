// When to buy a situational item (Nico, 2026-11-20: show the core build, then situational items with when to buy
// each). Worked out from the item's own shop text and stat groups, so it holds for every item and champion without
// a hand-kept list. Pure: the server tags items (lib/items.ts itemSituation) and the browser only reads the tag.

export const SITUATIONS = {
  healing: "Vs healing",
  shields: "Vs shields",
  cc: "Vs heavy crowd control",
  burst: "Vs burst",
  crit: "Vs crit carries",
  tanks: "Vs tanks",
  mixed: "Vs mixed damage",
  magic: "Vs magic damage",
  physical: "Vs physical damage",
} as const;
export type Situation = keyof typeof SITUATIONS;

/** The situation an item answers, from its shop description (HTML) and stat groups, or null for a general item.
 *  The first rule that matches wins, most specific first. */
export function situationFor(description: string, categories: string[]): Situation | null {
  const d = description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const has = (c: string) => categories.includes(c);
  if (/\bWounds\b/.test(d)) return "healing";
  if (/Shield Reaver|reduces? (any|all) shields/i.test(d)) return "shields";
  if (/Removes? all (crowd control )?debuffs|Removes? all crowd control/i.test(d)) return "cc";
  if (/\bStasis\b|Spell Shield|\bLifeline\b|\bRebirth\b/.test(d)) return "burst";
  if (/less damage from Critical Strikes|Critical Strikes deal \d+% less/i.test(d)) return "crit";
  if (!/Heal and Shield Power/.test(d) && /\d+% (Armor|Magic) Penetration|reduces the target's Armor|reduces their Magic Resist|max(imum)? Health (magic |physical |true )?damage/i.test(d)) return "tanks";
  const mr = has("SpellBlock") || has("MagicResist");
  if (mr && has("Armor")) return "mixed";
  if (mr && !has("SpellDamage")) return "magic";
  if (has("Armor") && !has("SpellDamage")) return "physical";
  return null;
}

/** How an anti-heal item applies its Wounds, from its shop text: on the holder's physical or magic damage, or when the
 *  holder is struck by an attack (Thornmail). Null when it applies none. */
export function woundsBy(description: string): "physical" | "magic" | "struck" | null {
  const d = description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  if (!/\bWounds\b/.test(d)) return null;
  if (/when struck by an? (basic )?attack/i.test(d)) return "struck";
  if (/dealing physical damage/i.test(d)) return "physical";
  if (/dealing magic damage/i.test(d)) return "magic";
  return null;
}

/** Whether an anti-heal item's Wounds reach enemies for this champion (Nico 2026-11-28: Thornmail on Nami): its
 *  physical or magic damage, or being struck by attacks for a champion that takes more of its team's damage than most.
 *  Items without Wounds, or champions without traits, always fit. */
export function woundsFit(description: string, traits: { physical: boolean; tank: boolean } | null): boolean {
  const by = woundsBy(description);
  if (!by || !traits) return true;
  return by === "struck" ? traits.tank : by === "physical" ? traits.physical : !traits.physical;
}

