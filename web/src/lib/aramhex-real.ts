import "server-only";
import { readRepoJson } from "./repo-data";

// Real game counts straight from the AramHex files (data/aramhex/patches/<latest>/, written by fetch.py), for the
// tabs the 101 feed never covered: Weapon of Destiny's first item and the Pentakill Empowers.

/** One of the latest AramHex patch's files, or null before the first fetch. */
export function aramhexLatest<T>(name: string): T | null {
  const latest = readRepoJson<{ latest: string }>("data/aramhex/patches/index.json")?.latest;
  return latest ? readRepoJson<T>(`data/aramhex/patches/${latest}/${name}.json`) : null;
}

/** The latest AramHex patch, as fetch.py names it ("16.23"). */
export const aramhexPatch = () => readRepoJson<{ latest: string }>("data/aramhex/patches/index.json")?.latest ?? null;

export type Count = { games: number; wins: number; /** Expected win rate for these games (their champions' average). */ base: number };

/**
 * Win rate above expectation for each row, shrunk toward the rows' average by how many games it has (empirical
 * Bayes: the spread between rows beyond what sampling explains decides how far a row's own number is trusted).
 * The same idea as the card's DeepScore shrink (lib/card-score.ts scoreRows), on lifts so champions of different
 * strength compare fairly.
 */
export function shrunkLifts(rows: Count[]): number[] {
  const ok = rows.filter((r) => r.games > 0);
  if (!ok.length) return rows.map(() => 0);
  const lift = (r: Count) => (r.games ? r.wins / r.games - r.base : 0);
  const v = (r: Count) => Math.max(1e-4, r.base * (1 - r.base)) / Math.max(1, r.games);
  const n = ok.reduce((t, r) => t + r.games, 0);
  const mean = ok.reduce((t, r) => t + r.games * lift(r), 0) / n;
  const spread = ok.reduce((t, r) => t + r.games * (lift(r) - mean) ** 2, 0) / n;
  const noise = ok.reduce((t, r) => t + r.games * v(r), 0) / n;
  const tau2 = Math.max(1e-6, spread - noise);
  return rows.map((r) => (r.games ? mean + (tau2 / (tau2 + v(r))) * (lift(r) - mean) : mean));
}
