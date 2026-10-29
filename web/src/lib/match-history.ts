import "server-only";
import { db } from "./accounts";

// The site owner's own Mayhem games, saved to their account from My Stats so the dashboard on /account shows
// them on any device. Private: only the account they belong to can read them, and nothing here is public or
// shared. Each game keeps the player's own stats, the Riot ID and a few stats of their teammates (for the
// Teammates card), and only the champion and team of the other team; the player's own participant is marked
// "me" instead of an account id. No one else's account id is kept.
// Data: the PROFILES D1 database, next to the accounts it belongs to.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS account_games (account TEXT NOT NULL, game_id TEXT NOT NULL, played INTEGER NOT NULL,
    data TEXT NOT NULL, PRIMARY KEY (account, game_id))`,
];

export const ME = "me";
const STATS = [
  "kills", "deaths", "assists", "totalDamageDealtToChampions", "totalDamageTaken", "totalHeal", "largestKillingSpree",
  "pentaKills", "quadraKills", "playerAugment1", "playerAugment2", "playerAugment3", "playerAugment4", "playerAugment5",
  "playerAugment6", "item0", "item1", "item2", "item3", "item4", "item5", "item6",
] as const;

const MATE_STATS = ["kills", "deaths", "assists", "totalDamageDealtToChampions"] as const;

const n = (v: unknown, max = 1e9) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Math.round(Number(v)))) : 0);
const name = (v: unknown) => (typeof v === "string" ? v.replace(/[<>\p{C}]/gu, "").slice(0, 40) : undefined);

export type HistoryGame = { gameId: number; gameCreation: number; gameDuration: number; queueId: number; gameVersion: string; participants: unknown[]; killMap?: number[][] };

/** A game as My Stats sends it, reduced to what the dashboard reads; null if it doesn't look like one of the player's games. */
export function cleanHistoryGame(raw: unknown): HistoryGame | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  const gameId = n(g.gameId, 1e15);
  const version = typeof g.gameVersion === "string" && /^\d{1,2}\.\d{1,2}[\d.]*$/.test(g.gameVersion) ? g.gameVersion.slice(0, 20) : "";
  // A game with no creation time has no day to count it on, so it isn't kept (the shared-games cleaner does the same).
  const gameCreation = n(g.gameCreation, 1e14);
  if (!gameId || !version || !gameCreation) return null;
  let mine = 0;
  const participants = (Array.isArray(g.participants) ? g.participants : []).slice(0, 10).map((x) => {
    const p = (x ?? {}) as Record<string, unknown>;
    const base = { participantId: n(p.participantId, 20), teamId: n(p.teamId, 300), championId: n(p.championId, 1e5) };
    if (p.puuid !== ME) return { ...base, mate: p };
    mine++;
    const s = (p.stats ?? {}) as Record<string, unknown>;
    const stats: Record<string, number | boolean> = { win: s.win === true };
    for (const k of STATS) stats[k] = n(s[k]);
    return { ...base, puuid: ME, championName: name(p.championName), riotIdGameName: name(p.riotIdGameName), riotIdTagline: name(p.riotIdTagline), stats };
  });
  if (mine !== 1) return null;
  // Teammates keep their Riot ID and a few stats (My Stats' Teammates card); the other team only champions.
  const team = participants.find((p) => "puuid" in p)?.teamId;
  const cleaned = participants.map((p) => {
    if (!("mate" in p)) return p;
    const { mate, ...base } = p;
    const gameName = name(mate.riotIdGameName);
    if (base.teamId !== team || !gameName) return base;
    const s = (mate.stats ?? {}) as Record<string, unknown>;
    const stats: Record<string, number> = {};
    for (const k of MATE_STATS) stats[k] = n(s[k]);
    return { ...base, riotIdGameName: gameName, riotIdTagline: name(mate.riotIdTagline), stats };
  });
  // Each kill is [seconds, x, y, killer, victim]; a shorter row would leave the dashboard's kill map with holes.
  const killMap = Array.isArray(g.killMap)
    ? g.killMap.slice(0, 400).filter((k) => Array.isArray(k) && k.length >= 5).map((k) => (k as unknown[]).slice(0, 5).map((v) => n(v, 1e6)))
    : undefined;
  // gameDuration is seconds in newer games and milliseconds in older ones (as the dashboard and lib/shared-games.ts know).
  const rawDuration = n(g.gameDuration, 1e10);
  const gameDuration = rawDuration > 20000 ? Math.round(rawDuration / 1000) : rawDuration;
  return { gameId, gameCreation, gameDuration, queueId: n(g.queueId, 1e5), gameVersion: version, participants: cleaned, killMap };
}

async function table() {
  const d = await db();
  await d.batch(SCHEMA.map((s) => d.prepare(s)));
  return d;
}

/** The owner account a Riot account is connected to, or null when it isn't the owner's. */
export async function ownerAccountFor(puuid: string): Promise<string | null> {
  const row = await (await db()).prepare("SELECT id FROM accounts WHERE riot_puuid = ? AND owner = 1").bind(puuid).first<{ id: string }>();
  return row?.id ?? null;
}

export async function saveHistory(account: string, games: HistoryGame[]) {
  const d = await table();
  const stmts = games.map((g) =>
    d.prepare("INSERT OR REPLACE INTO account_games (account, game_id, played, data) VALUES (?, ?, ?, ?)").bind(account, String(g.gameId), g.gameCreation, JSON.stringify(g)),
  );
  if (stmts.length) await d.batch(stmts);
  return historyCount(account);
}

export async function historyCount(account: string) {
  const d = await table();
  return (await d.prepare("SELECT count(*) AS n FROM account_games WHERE account = ?").bind(account).first<{ n: number }>())?.n ?? 0;
}

export async function historyGames(account: string): Promise<HistoryGame[]> {
  const d = await table();
  const { results } = await d.prepare("SELECT data FROM account_games WHERE account = ? ORDER BY played DESC").bind(account).all<{ data: string }>();
  return results.map((r) => JSON.parse(r.data) as HistoryGame);
}

export async function removeHistory(account: string) {
  await (await table()).prepare("DELETE FROM account_games WHERE account = ?").bind(account).run();
}
