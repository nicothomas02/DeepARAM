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
  // Nico 2026-11-24 added these two splits (weaker evidence): pinned so the split is always followed by a W max.
  Azir: ["W", "Q", "E"],
  Soraka: ["W", "Q", "E"],
  // Nico 2026-11-24 (splits with a kit reason, weaker evidence): Dr. Mundo maxes E after Q to 3; Rumble Q after E to 3.
  // Ashe isn't pinned: her crit and AP builds max different abilities, and the W split leads both.
  DrMundo: ["E", "Q", "W"],
  Rumble: ["Q", "E", "W"],
};

/**
 * Split skill orders: put `points` into `first` before following the champion's order (Katarina: Q to 3, then max E).
 * Nico's pick 2026-11-24, cross-checked once on regular ARAM (no augments, all ranks, 30 days): the only two intentional
 * splits that beat the champion's best standard order at levels 10 and 15 (Katarina 57% vs 50%, Kayn 56% vs 48%, 800+
 * games each). Not stored or shown as data: research/split-skill-orders-lolalytics-2026-11-24.md.
 */
export type SkillSplit = { first: "Q" | "W" | "E"; points: number; weak?: boolean };
export const CHAMPION_SPLITS: Record<string, SkillSplit> = {
  Katarina: { first: "Q", points: 3 },
  Kayn: { first: "Q", points: 3 },
  // Nico added these 2026-11-24 as weaker evidence: they lead their best standard order at levels 10 and 15 on the
  // same cross-check (Azir 51% vs 48% and 55% vs 52%, Soraka 54% vs 53% and 58% vs 55%), but within what luck gives.
  Azir: { first: "Q", points: 3, weak: true },
  Soraka: { first: "Q", points: 3, weak: true },
  // Nico added these 2026-11-24 because the split has a kit reason (early poke or waveclear from the 3-point ability),
  // not for the win rates, which are about even with the best standard order (Dr. Mundo +1 and +2 points at levels 10
  // and 15, Ashe +0 and +2, Rumble +2 at level 10).
  DrMundo: { first: "Q", points: 3, weak: true },
  Ashe: { first: "W", points: 3, weak: true },
  Rumble: { first: "E", points: 3, weak: true },
};
