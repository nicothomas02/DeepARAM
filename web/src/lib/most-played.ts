import CHAMPIONS from "@/data/champion-names.json";
import CHAMPION_IDS from "@/data/champion-ids.json";

// The account icon follows the player's most played champion unless they picked one themselves.
// Stored icon values (account_profile.icon): NULL = follow most played (the default), "none" = no icon,
// a champion key ("Ahri") = that champion.
export const ICON_AUTO = "auto";
export const ICON_NONE = "none";

const BY_ID = new Map(Object.entries(CHAMPION_IDS as Record<string, number>).map(([key, id]) => [id, key]));

/** Counts of the player's own champion across their saved games, most played first (account_games, lib/match-history.ts). */
export const MOST_PLAYED_SQL = `SELECT json_extract(p.value, '$.championId') AS champ, max(json_extract(p.value, '$.championName')) AS name,
    count(*) AS n, max(g.played) AS last
  FROM account_games g, json_each(g.data, '$.participants') p
  WHERE g.account = ? AND json_extract(p.value, '$.puuid') = 'me'
  GROUP BY champ ORDER BY n DESC, last DESC LIMIT 20`;

export type PlayedRow = { champ: unknown; name: unknown; n: number; last: number };

/** The champion key of the most played row; a tie goes to the one played most recently. Rows of champions the site doesn't know are skipped. */
export function mostPlayedChampion(rows: PlayedRow[]): string | null {
  const known = rows
    .map((r) => ({ ...r, key: BY_ID.get(Number(r.champ)) ?? (typeof r.name === "string" && r.name in CHAMPIONS ? r.name : null) }))
    .filter((r) => r.key);
  known.sort((a, b) => b.n - a.n || b.last - a.last);
  return known[0]?.key ?? null;
}

/** What the stored value means: the icon to show is worked out by the caller for "auto". */
export function iconChoice(stored: string | null | undefined): string {
  if (stored === ICON_NONE) return ICON_NONE;
  return stored && stored in CHAMPIONS ? stored : ICON_AUTO;
}

/** The value to store for what the account page sent. */
export function storedIcon(raw: unknown): string | null {
  if (raw === ICON_NONE) return ICON_NONE;
  return typeof raw === "string" && raw in CHAMPIONS ? raw : null;
}
