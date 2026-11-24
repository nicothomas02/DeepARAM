import "server-only";
import { readRepoJson } from "./repo-data";
import { followed, scoreRows } from "./card-score";
import type { Rated } from "./card-score";

/**
 * Skill orders from real level-ups (data/estimates/skill_orders.json, built by skill_orders.py): the other players in
 * the owner's archived lobbies, per champion and per build style. Nico chose this on 2026-11-24 after the champion
 * review found the feed's skill orders are one generic list for every champion. Shown as estimated.
 *
 * Rows rank by DeepScore (scoreRows: each order's win rate shrunk by its own sampling noise against the list), not by
 * how many players take them (Nico 2026-11-24: "find what actually has best DeepScore"). As for builds, an order needs a
 * real following (MIN_FOLLOWING of the most taken one's players) to lead, so one lucky game can't top the list. With
 * tens of games most orders score alike, and then the more common one leads.
 */
export type SkillOrderRow = Rated & { max: string[]; levels: string[]; deepScore?: number; games: number };
type Raw = { max: string; games: number; wins: number; levels: string };
type File = { champions: Record<string, { all: Raw[]; styles: Record<string, Raw[]> }> };

/** A build style uses its own orders once this many of its players have them; else the champion's. */
export const MIN_STYLE_PLAYERS = 20;

function score(raw: Raw[]): SkillOrderRow[] {
  const total = raw.reduce((s, r) => s + r.games, 0);
  if (!total) return [];
  const mean = raw.reduce((s, r) => s + r.wins, 0) / total;
  const rows = raw.map((r) => ({
    max: [...r.max],
    levels: [...r.levels],
    winRate: r.wins / r.games,
    pickRate: r.games / total,
    lift: r.wins / r.games - mean,
    games: r.games,
  }));
  return followed(scoreRows(rows) as SkillOrderRow[]);
}

/** The champion's skill orders, best DeepScore first, and each build style's where it has enough players. */
export function skillOrders(id: number): { all: SkillOrderRow[]; styles: Record<string, SkillOrderRow[]> } | null {
  const c = readRepoJson<File>("data/estimates/skill_orders.json")?.champions[String(id)];
  if (!c) return null;
  const styles: Record<string, SkillOrderRow[]> = {};
  for (const [style, raw] of Object.entries(c.styles ?? {}))
    if (raw.reduce((s, r) => s + r.games, 0) >= MIN_STYLE_PLAYERS) styles[style] = score(raw);
  return { all: score(c.all ?? []), styles };
}
