/**
 * Skill max orders that change once an augment is taken, per champion alias. The site's skill card shows them under
 * the best order, and the build engine (site overlay and both apps) switches to them when the augment is taken.
 *
 * Not from data: no source splits skill orders by augment (ARAMKit has none; 2 Gwens with Ethereal Weapon in the
 * archived lobbies). Each entry is Nico's call, shown as estimated.
 */
export type AugmentSkill = { augment: number; skills: string[] };

export const AUGMENT_SKILLS: Record<string, AugmentSkill[]> = {
  // Gwen's Ethereal Weapon entry (E>Q>W) is now her order in every game: see CHAMPION_SKILLS.
};

/**
 * Skill max orders that replace the lobby data's best order for a champion in every game, per champion alias. The
 * site's skill card, the quick build and the build engine all follow them. Not from data: each entry is Nico's call,
 * shown as estimated, with the lobby rows still listed in the Skill order table.
 */
export const CHAMPION_SKILLS: Record<string, string[]> = {
  // Nico 2026-11-24 chose "Always E>Q>W" (first asked for it with Ethereal Weapon only). No other lobby Gwen maxed E
  // first, so there are no stats behind it.
  Gwen: ["E", "Q", "W"],
};
