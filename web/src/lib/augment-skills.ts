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
  // Nico 2026-11-24 chose the split cue for these two (see CHAMPION_SPLITS): the order after the split.
  Katarina: ["E", "Q", "W"],
  Kayn: ["W", "Q", "E"],
};

/**
 * Split skill orders: put `points` into `first` before following the champion's order (Katarina: Q to 3, then max E).
 * Nico's pick 2026-11-24, cross-checked once on regular ARAM (no augments, all ranks, 30 days): the only two intentional
 * splits that beat the champion's best standard order at levels 10 and 15 (Katarina 57% vs 50%, Kayn 56% vs 48%, 800+
 * games each). Not stored or shown as data: research/split-skill-orders-lolalytics-2026-11-24.md.
 */
export type SkillSplit = { first: "Q" | "W" | "E"; points: number };
export const CHAMPION_SPLITS: Record<string, SkillSplit> = {
  Katarina: { first: "Q", points: 3 },
  Kayn: { first: "Q", points: 3 },
};
