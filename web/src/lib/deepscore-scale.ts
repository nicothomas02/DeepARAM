// The DeepScore scale, shared by every surface (Nico 2026-11-24: "0-100 + tier letter" everywhere, one palette).
// No data imports, so client components and the apps (apps/desktop/ui/companion.html deepTier, DeepARAM-PC) can
// mirror it exactly.
//
// - DeepScore runs 0-100. 50 is the average of its own list (a champion's augments, the champion tier list, ...),
//   and each 15 points is one standard deviation of that list (lib/deepscore.ts grade), so compare numbers within a
//   list, not across lists.
// - The tier letter is cut on the rounded score: S 70+, A 59+, B 44+, C 32+, D below (z 1.35 / 0.6 / -0.4 / -1.2).
// - One colour per tier, the same on rings, chips and app numbers (globals.css --tier-s ... --tier-d).

/** Lowest DeepScore of each tier, best first. */
export const TIER_CUTS: [string, number][] = [
  ["S", 70],
  ["A", 59],
  ["B", 44],
  ["C", 32],
  ["D", -Infinity],
];

/** The tier letter of a DeepScore. */
export function tierOfScore(deepScore: number): string {
  return TIER_CUTS.find(([, min]) => Math.round(deepScore) >= min)![0];
}

/** Lowest DeepScore of a tier. */
export const tierCut = (tier: string): number => TIER_CUTS.find(([t]) => t === tier)![1];

/** Tier colours (default palette), as on the site's tier chips; globals.css repeats them as --tier-* with colourblind
 *  and light-mode variants. */
export const TIER_COLORS: Record<string, string> = {
  S: "#e0573f",
  A: "#f0913a",
  B: "#e6c24a",
  C: "#7fb6e8",
  D: "#8b93a3",
};

/** The one explanation every DeepScore hover starts with. */
export const DEEPSCORE_ONE_LINE =
  "DeepScore rates a pick from 0 to 100 against the rest of its own list: 50 is that list's average, and the letter is its tier (S 70+, A 59+, B 44+, C 32+, D below).";
