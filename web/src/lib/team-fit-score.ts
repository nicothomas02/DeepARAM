// "Best pick for your team": ranks champions for a team from public live stats only (lib/team-fit.ts builds the
// data, /data/team-fit.json serves it to the Tier List and the desktop app). Pure, so the site and the app score alike.
//
// A pick's score, in win-rate points: the champion's expected win rate over 50% (DeepScore's next-patch estimate),
// plus its synergy with each ally already on the team. Synergy is the Duos tab's Win rate boost for that exact pair,
// else the boost of the two champions' archetypes (Enchanter + Marksman), averaged over their subclasses, so two
// marksmen or a team with no frontline show up even for pairs the stats don't list. Ranking only: the duo list
// leans to pairs that do well together, so the synergy part is a guide, not a promised gain.

export type TeamFitData = {
  patch: string | null;
  /** alias -> [expected win rate, archetypes] */
  champions: Record<string, [number, string[]]>;
  /** "A B" (aliases sorted) -> Win rate boost */
  pairs: Record<string, number>;
  /** "X+Y" (archetypes sorted) -> boost */
  archetypes: Record<string, number>;
  /** alias -> numeric champion id, for the desktop app's champion select (which reports ids) */
  ids?: Record<string, number>;
};

export type PairPart = { ally: string; boost: number; exact: boolean };
export type Pick = {
  id: string;
  score: number;
  strength: number;
  fit: number;
  parts: PairPart[];
};

export const pairKey = (a: string, b: string) => [a, b].sort().join(" ");

export function pairBoost(
  d: TeamFitData,
  a: string,
  b: string,
): { boost: number; exact: boolean } {
  const exact = d.pairs[pairKey(a, b)];
  if (exact !== undefined) return { boost: exact, exact: true };
  const as = d.champions[a]?.[1] ?? [];
  const bs = d.champions[b]?.[1] ?? [];
  let sum = 0;
  let n = 0;
  for (const x of as)
    for (const y of bs) {
      const v = d.archetypes[[x, y].sort().join("+")];
      if (v !== undefined) {
        sum += v;
        n += 1;
      }
    }
  return { boost: n ? sum / n : 0, exact: false };
}

/** Ranks `options` (every champion when empty) for a team that already has `allies`; best first.
 *  `fit` is measured against the average champion's fit with the same team (listed pairs lean positive, so the raw
 *  sum would flatter every pick), and each pair's `boost` against the average champion's pair with that ally. */
export function rankPicks(
  d: TeamFitData,
  allies: string[],
  options: string[] = [],
): Pick[] {
  const team = allies.filter((a) => d.champions[a]);
  const others = Object.keys(d.champions).filter((id) => !team.includes(id));
  const avg = new Map(
    team.map((a) => [
      a,
      others.reduce((s, id) => s + pairBoost(d, id, a).boost, 0) /
        (others.length || 1),
    ]),
  );
  const pool = (options.length ? options : others).filter(
    (id) => d.champions[id] && !team.includes(id),
  );
  return pool
    .map((id) => {
      const strength = d.champions[id][0] - 0.5;
      const parts = team.map((ally) => {
        const p = pairBoost(d, id, ally);
        return { ally, boost: p.boost - (avg.get(ally) ?? 0), exact: p.exact };
      });
      const fit = parts.reduce((s, p) => s + p.boost, 0);
      return { id, score: strength + fit, strength, fit, parts };
    })
    .sort((x, y) => y.score - x.score);
}
