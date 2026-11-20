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
