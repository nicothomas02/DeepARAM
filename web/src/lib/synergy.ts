// Duo synergy: how much more two champions win together than their own win rates predict.
//
// Two strong champions win a lot together even if they don't help each other, so the pair's win rate
// alone (or its gap to the average of the two) mostly rewards strong champions. Instead we work out the
// win rate the pair would have if neither did anything for the other: on the log-odds scale, each
// champion's edge over a coin flip adds up (a 55% and a 55% champion would win about 59.9% together).
// Synergy is the pair's real win rate minus that expected one, in percentage points. Pairs seen in fewer
// games are pulled toward zero, so a rare pair with a lucky streak can't top the list.

const PRIOR_PICK = 0.01; // a pair picked this often keeps half of its raw synergy

const clamp = (p: number) => Math.min(0.99, Math.max(0.01, p));
const logit = (p: number) => Math.log(clamp(p) / (1 - clamp(p)));

/** The win rate two champions would have together if they didn't help or hurt each other. */
export const expectedPairWinRate = (a: number, b: number) => 1 / (1 + Math.exp(-(logit(a) + logit(b))));

/** Pair win rate minus the expected one, shrunk toward zero for rarely picked pairs. */
export function synergy(pairWinRate: number, a: number, b: number, pickRate: number): number {
  const weight = pickRate / (pickRate + PRIOR_PICK);
  return (pairWinRate - expectedPairWinRate(a, b)) * weight;
}
