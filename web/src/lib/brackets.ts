import "server-only";
import championIds from "@/data/champion-ids.json";
import { readRepoJson } from "./repo-data";

// Champion win and pick rates by skill bracket (casual, mid, top 5%), for the Tier List's bracket filter.
// Brackets come from a rating built from who beat whom in each region, not official ranks, and only some patches
// have them (data/aramhex/fetch.py). Players without a rating count only in "All players".

export const BRACKETS = ["casual", "mid", "high"] as const;
export type Bracket = (typeof BRACKETS)[number];
/** Per patch, per bracket: matches (bracket games / 10, so pick rates sum to 10 like the main table) and each
 *  champion's [win rate, pick rate]. */
export type BracketData = Record<string, Partial<Record<Bracket, { matches: number; champs: Record<string, [number, number]> }>>>;

const ALIAS = Object.fromEntries(Object.entries(championIds as Record<string, number>).map(([a, id]) => [String(id), a]));

export function bracketData(): BracketData {
  const out: BracketData = {};
  const patches = readRepoJson<{ patches: string[] }>("data/aramhex/patches/index.json")?.patches ?? [];
  for (const p of patches) {
    for (const b of BRACKETS) {
      const h = readRepoJson<Record<string, [number, number]>>(`data/aramhex/patches/${p}/bands/${b}/heroes.json`);
      if (!h) continue;
      const matches = Object.values(h).reduce((s, [g]) => s + g, 0) / 10;
      const champs: Record<string, [number, number]> = {};
      for (const [id, [g, w]] of Object.entries(h)) {
        const a = ALIAS[id];
        if (a && g > 0) champs[a] = [Math.round((w / g) * 1e4) / 1e4, Math.round((g / matches) * 1e4) / 1e4];
      }
      (out[p] ??= {})[b] = { matches: Math.round(matches), champs };
    }
  }
  return out;
}

/** One champion's [win rate, pick rate] per skill bracket from the newest patch that has brackets (up to `patch`),
 *  with that patch, or null when none has them. */
export function championBrackets(alias: string, patch: string | null) {
  const data = bracketData();
  const key = (p: string) => p.split(".").map(Number);
  const newer = (a: string, b: string) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1];
  const p = Object.keys(data)
    .filter((x) => !patch || newer(x, patch) <= 0)
    .sort(newer)
    .reverse()
    .find((x) => BRACKETS.some((b) => data[x][b]?.champs[alias]));
  if (!p) return null;
  const rates: Partial<Record<Bracket, [number, number]>> = {};
  for (const b of BRACKETS) {
    const c = data[p][b]?.champs[alias];
    if (c) rates[b] = c;
  }
  return { patch: p, rates };
}
