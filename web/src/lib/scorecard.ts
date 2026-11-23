import "server-only";
import { readRepoJson } from "./repo-data";

// How each patch's DeepScore picks held up on the next patch (data/aramhex/scorecard.py, Nico 2026-11-23): each
// champion's top 5 augments and top 3 items, against the most picked ones as the baseline. Aggregates only.

export type Score = { n: number; hit: number; lead: number };
export type ScorePair = {
  from: string;
  to: string;
  to_partial: boolean;
  augments: { deepscore: Score; popular: Score } | null;
  items?: { deepscore: Score; popular: Score } | null;
  champions: { n: number; still_above_50: number; avg_next: number } | null;
};

export function scorecard(): ScorePair[] {
  return (readRepoJson<{ pairs: ScorePair[] }>("data/aramhex/scorecard.json")?.pairs ?? []).filter((p) => p.augments).reverse();
}
