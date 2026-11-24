import "server-only";
import championNames from "@/data/champion-names.json";
import { readRepoJson } from "./repo-data";

// The Tier List's Full teams view (?cview=teams): the strongest five-champion teams, projected from each champion's own
// results plus the ten pair synergies inside the team (data/estimates/teams.py, refreshed daily). No game data records
// whole teams, so every row is projected. Checked on data: pair synergy carries over 95% from one patch to the next,
// and pairs add up on average. Assumed, and can't be checked: that the ten pairs still add up for a full team; summing
// them likely overstates the top teams, so the page shows ranks and where a team's strength comes from, never a
// projected win rate (Nico, 2026-11-24, "even if it's mostly projected"; sanity rule).

type Team = {
  champions: number[];
  names: string[];
  projected_win_rate: number;
  from_champions: number;
  synergy_pts: number;
  pairs_known: number;
  best_pairs?: [string, string][];
};
type TeamsFile = { teams: Team[] };

export type TeamRow = {
  /** Champion aliases ("TwistedFate"), strongest first. */
  champions: string[];
  /** English display names by alias, for the champions in this row. */
  english: Record<string, string>;
  /** Share of the team's projected edge that comes from the five champions themselves, 0 to 1; the rest is synergy. */
  fromChampions: number;
  /** Pair synergies known out of the team's ten pairs. */
  pairsKnown: number;
  /** The team's strongest pair, when known. */
  bestPair: [string, string] | null;
};

export function fullTeams(): TeamRow[] {
  const file = readRepoJson<TeamsFile>("data/estimates/teams.json");
  return (file?.teams ?? []).flatMap((t) => {
    const own = (t.from_champions - 0.5) * 100;
    const total = own + t.synergy_pts;
    if (!(total > 0) || t.names.length !== 5) return [];
    return [
      {
        champions: t.names,
        english: Object.fromEntries(t.names.map((a) => [a, (championNames as Record<string, string>)[a] ?? a])),
        fromChampions: Math.min(1, Math.max(0, own / total)),
        pairsKnown: t.pairs_known,
        bestPair: t.best_pairs?.[0] ?? null,
      },
    ];
  });
}
