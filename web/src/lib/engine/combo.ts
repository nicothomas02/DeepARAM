// Combo odds, in their own file with no imports so the site's client code (lib/synergy-picks.ts, used by the champion
// page's augment list) can read them without shipping the whole build engine and its data to the browser.

/** Chance per augment pick left that a combo partner is offered again (flat rule). */
export const COMBO_ODDS = 0.04;
/** Most a combo's potential can add. */
export const COMBO_CAP = 0.12;
