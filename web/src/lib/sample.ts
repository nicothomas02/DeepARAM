import "server-only";
import { readRepoJson } from "./repo-data";

// Estimated game counts behind each patch's stats (data/stats/games.py, from day-to-day win-rate noise).
// A champion's games = pick rate × the patch's matches; an item's or a teammate pair's = its share × the
// champion's games. Feed these to lib/stats.ts for intervals and low-sample flags.

type Games = {
  median_per_day: number;
  patches: Record<string, { days: number; per_day: number; matches: number; estimated: boolean }>;
};

let cache: Games | null | undefined;
const data = () => (cache === undefined ? (cache = readRepoJson<Games>("data/stats/games.json")) : cache);

/** Estimated matches behind one patch's numbers (falls back to two weeks at the typical rate). */
export function patchMatches(patch: string | null | undefined): number | undefined {
  const d = data();
  if (!d) return undefined;
  const p = patch ? d.patches[patch] : undefined;
  return p ? p.matches : d.median_per_day * 14;
}

/** A champion's estimated games over a set of patches, from its pick rate on each. */
export function gamesFor(rows: { patch: string; pick_rate: number }[]): number | undefined {
  if (!data()) return undefined;
  return rows.reduce((s, r) => s + r.pick_rate * (patchMatches(r.patch) ?? 0), 0);
}

/** Estimated matches for every patch, for client components that combine patches themselves. */
export function matchesByPatch(): Record<string, number> | undefined {
  const d = data();
  return d ? Object.fromEntries(Object.entries(d.patches).map(([p, v]) => [p, v.matches])) : undefined;
}
