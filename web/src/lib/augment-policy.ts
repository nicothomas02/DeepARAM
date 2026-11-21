// Riot's developer policy doesn't allow showing augment win rates (Nico 2026-11-11: hide them). Augments show
// their DeepScore, pick rate and estimated boost in points instead. Flip this to bring the win rate numbers back.
export const SHOW_AUGMENT_WIN_RATES = false;

/**
 * Share of an augment's picks needed to tag it with a pick (1st to 4th). The pick timing comes from the owner's archived
 * games (all ten players, about 49k picks; the main feed has none), so the tag asks for a clear share: at 35% nine in ten
 * tags hold up against another stats site's much larger sample, against eight in ten at 25% (checked 2026-11-21).
 */
export const PICK_TAG_SHARE = 0.35;
