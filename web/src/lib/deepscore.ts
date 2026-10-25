// DeepScore: one 0-100 rating for every champion and augment on the tier lists, and the tier it falls in.
//
// 1. Confidence: each win rate is pulled toward the list's average (a beta prior), then the score uses the
//    low end of its likely range (posterior mean minus one standard deviation), so a high win rate from
//    few games can't outrank a slightly lower one from many.
// 2. Recency: across several patches, older patches count for less (champions: lib/tiers.ts).
// 3. Spread: scores become z-scores against the rest of the list (50 is average, each 15 points is one
//    standard deviation), and tiers are cut at fixed z-scores, so they stay balanced as averages drift.
// 4. Augments are judged against what the champions who take them win anyway (lib/augment-tiers.ts).

/** How many standard deviations below the estimate the score sits. */
const Z = 1;

/** The low end of a win rate's likely range, after pulling it toward `mean` with `prior` pseudo-games. */
export function lowerBound(
  winRate: number,
  games: number,
  mean: number,
  prior: number,
): number {
  const n = games + prior;
  const est = (winRate * games + mean * prior) / n;
  return est - Z * Math.sqrt((est * (1 - est)) / n);
}

/** Lowest z-score for each tier, best first. On a normal spread: S ~9%, A ~18%, B ~38%, C ~23%, D ~12%. */
export const TIER_Z: [string, number][] = [
  ["S", 1.35],
  ["A", 0.6],
  ["B", -0.4],
  ["C", -1.2],
  ["D", -Infinity],
];

export type Graded = { deepScore: number; tier: string };

/** DeepScore and tier for each value, against the whole list's spread. */
export function grade(values: number[]): Graded[] {
  if (!values.length) return [];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd =
    Math.sqrt(
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length,
    ) || 1;
  return values.map((v) => {
    const z = (v - mean) / sd;
    return {
      deepScore: Math.round(Math.min(100, Math.max(0, 50 + 15 * z))),
      tier: TIER_Z.find(([, min]) => z >= min)![0],
    };
  });
}

const CUTS = TIER_Z.slice(0, -1)
  .map(([t, z]) => `${t} ${Math.round(50 + 15 * z)}+`)
  .join(", ");

export const DEEPSCORE_HELP =
  "DeepScore rates each pick from 0 to 100, where 50 is average. It starts from win rate, trusts it less when " +
  "there are fewer games, counts the newest patch most, and compares each pick with the rest of the list. " +
  `Tiers: ${CUTS}, D below.`;

export const AUGMENT_DEEPSCORE_HELP =
  "DeepScore rates each augment from 0 to 100 against others of its rarity, where 50 is average. It compares the " +
  "augment's win rate with what the same champions win anyway, so augments that strong champions take don't look " +
  `better than they are, and trusts rarely picked augments less. Tiers: ${CUTS}, D below.`;

export const ITEM_DEEPSCORE_HELP =
  "DeepScore rates each item from 0 to 100 against this champion's other items of the same tier, where 50 is average. It starts " +
  `from the item's win rate with this champion and trusts rarely built items less. Tiers: ${CUTS}, D below.`;

export const BUILD_DEEPSCORE_HELP =
  "DeepScore rates each build from 0 to 100 against this champion's other builds in the same list, where 50 is average. " +
  `It starts from the build's win rate with this champion and trusts rarely built ones less. Tiers: ${CUTS}, D below.`;

export const ITEM_TIER_DEEPSCORE_HELP =
  "DeepScore rates each item from 0 to 100 against the other items of its tier, where 50 is average. It starts from how much " +
  `the item raises the win rate of the champions who build it and trusts rarely built items less. Tiers: ${CUTS}, D below.`;
