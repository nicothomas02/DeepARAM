import "server-only";
import { d1 } from "./env";

// Games players chose to share from My Stats, kept without names or account ids so the site can build
// stats across everyone's games (matchups, augment combos, objectives, team comps). Each game is stored
// once however many of its players share it. A sharer is recorded only as a salted hash, so they can
// stop sharing and remove what they sent.

const n = (v: unknown, max = 1e9) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Math.round(Number(v)))) : 0);
const ids = (v: unknown, len: number) => (Array.isArray(v) ? v.slice(0, len).map((x) => n(x, 1e7)).filter(Boolean) : []);
// Per-minute totals (gold, experience) from the game's timeline; up to 90 minutes.
const perMinute = (v: unknown, max: number) => (Array.isArray(v) ? v.slice(0, 90).map((x) => n(x, max)) : []);

export type SharedPlayer = {
  team: number; champ: number; win: boolean; k: number; d: number; a: number;
  dmg: number; taken: number; heal: number; gold: number; cs: number; level: number;
  multi: number[]; spree: number; augs: number[]; items: number[]; spells: number[]; styles: number[]; perks: number[];
  goldMin?: number[]; xpMin?: number[]; // games shared before these were added have none
};
export type SharedTeam = { id: number; win: boolean; towers: number; inhibs: number; firstBlood: boolean; firstTower: boolean };
export type SharedGame = { patch: string; queue: number; played: string; duration: number; teams: SharedTeam[]; players: SharedPlayer[] };

/** The game's key and its cleaned record, or null if it doesn't look like a real game. */
export async function cleanGame(raw: unknown): Promise<{ key: string; game: SharedGame } | null> {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = String(r.id ?? "");
  const platform = String(r.platform ?? "").toLowerCase();
  const patch = String(r.patch ?? "");
  const played = String(r.played ?? "");
  if (!/^\d{5,15}$/.test(id) || !/^[a-z0-9]{2,6}$/.test(platform) || !/^\d{1,2}\.\d{1,2}$/.test(patch) || !/^\d{4}-\d{2}-\d{2}$/.test(played)) return null;
  const players = (Array.isArray(r.players) ? r.players : []).slice(0, 10).map((x) => {
    const p = (x ?? {}) as Record<string, unknown>;
    return {
      team: n(p.team, 300), champ: n(p.champ, 100000), win: p.win === true,
      k: n(p.k, 200), d: n(p.d, 200), a: n(p.a, 300), dmg: n(p.dmg), taken: n(p.taken), heal: n(p.heal),
      gold: n(p.gold), cs: n(p.cs, 5000), level: n(p.level, 30), multi: ids(p.multi, 4), spree: n(p.spree, 200),
      augs: ids(p.augs, 6), items: ids(p.items, 7), spells: ids(p.spells, 2), styles: ids(p.styles, 2), perks: ids(p.perks, 6),
      goldMin: perMinute(p.goldMin, 500_000), xpMin: perMinute(p.xpMin, 500_000),
    };
  });
  if (players.length < 2 || players.some((p) => !p.champ)) return null;
  const teams = (Array.isArray(r.teams) ? r.teams : []).slice(0, 2).map((x) => {
    const t = (x ?? {}) as Record<string, unknown>;
    return { id: n(t.id, 300), win: t.win === true, towers: n(t.towers, 20), inhibs: n(t.inhibs, 20), firstBlood: t.firstBlood === true, firstTower: t.firstTower === true };
  });
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${platform}:${id}`));
  const key = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return { key, game: { patch, queue: n(r.queue, 100000), played, duration: n(r.duration, 36000), teams, players } };
}

const db = () => {
  const g = d1("GAMES");
  if (!g) throw new Error("storage unavailable");
  return g;
};

async function sharerId(puuid: string) {
  const salt = (await db().prepare("SELECT v FROM meta WHERE k = 'salt'").bind().first<{ v: string }>())?.v ?? "";
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${puuid}`));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function shareGames(puuid: string, games: { key: string; game: SharedGame }[]) {
  const sharer = await sharerId(puuid);
  const g = db();
  const stmts = games.flatMap(({ key, game }) => [
    g.prepare("INSERT OR IGNORE INTO games (game_key, patch, queue, played, duration, data) VALUES (?, ?, ?, ?, ?, ?)")
      .bind(key, game.patch, game.queue, game.played, game.duration, JSON.stringify(game)),
    g.prepare("INSERT OR IGNORE INTO sharers (game_key, sharer) VALUES (?, ?)").bind(key, sharer),
  ]);
  if (stmts.length) await g.batch(stmts);
  return sharedCount(puuid, sharer);
}

export async function sharedCount(puuid: string, sharer?: string) {
  const s = sharer ?? (await sharerId(puuid));
  return (await db().prepare("SELECT count(*) AS n FROM sharers WHERE sharer = ?").bind(s).first<{ n: number }>())?.n ?? 0;
}

/** Removes this player's link to every game; games nobody else shared go too. */
export async function unshareGames(puuid: string) {
  const sharer = await sharerId(puuid);
  const g = db();
  await g.batch([
    g.prepare("DELETE FROM games WHERE game_key IN (SELECT game_key FROM sharers WHERE sharer = ?) AND game_key NOT IN (SELECT game_key FROM sharers WHERE sharer <> ?)").bind(sharer, sharer),
    g.prepare("DELETE FROM sharers WHERE sharer = ?").bind(sharer),
  ]);
}

/** How many shared games the site holds, in all and on one patch (Home's counts). */
export async function sharedTotals(patch: string | null) {
  const row = await db()
    .prepare("SELECT count(*) AS n, sum(CASE WHEN patch = ? THEN 1 ELSE 0 END) AS p FROM games")
    .bind(patch ?? "")
    .first<{ n: number; p: number | null }>();
  return { all: row?.n ?? 0, patch: row?.p ?? 0 };
}
