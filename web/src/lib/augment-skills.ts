/**
 * Skill max orders that change once an augment is taken, per champion alias. The site's skill card shows them under
 * the best order, and the build engine (site overlay and both apps) switches to them when the augment is taken.
 *
 * Not from data: no source splits skill orders by augment (ARAMKit has none; 2 Gwens with Ethereal Weapon in the
 * archived lobbies). Each entry is Nico's call, shown as estimated.
 */
export type AugmentSkill = { augment: number; skills: string[] };

export const AUGMENT_SKILLS: Record<string, AugmentSkill[]> = {
  // Nico 2026-11-24: "skill order for Gwen should be eqw when ethereal". Ethereal Weapon (1029) makes her abilities
  // apply on-hit; maxing Skip 'n Slash (E) first.
  Gwen: [{ augment: 1029, skills: ["E", "Q", "W"] }],
};
