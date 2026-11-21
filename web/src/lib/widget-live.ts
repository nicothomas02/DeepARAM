import { db } from "./accounts";

// The owner's live Mayhem game for the iPhone (widgets and the Live Activity). The owner's PC app posts it every few
// seconds during a game (/api/widget/live), and the phone registers where Apple should push it (/api/widget/push).
// The PC app sends the pushes to Apple itself with its own key (Apple needs HTTP/2, which a Worker's fetch doesn't
// speak), so the site only keeps the latest state and hands the PC app the phone's push tokens.
// Private: only the owner account, never on a public page. Data: the PROFILES D1 database.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS widget_live (account TEXT PRIMARY KEY, data TEXT NOT NULL, updated INTEGER NOT NULL)`,
  // kind "start": the phone's push-to-start token; "activity": the running Live Activity's token.
  `CREATE TABLE IF NOT EXISTS widget_push (account TEXT NOT NULL, kind TEXT NOT NULL, token TEXT NOT NULL, sandbox INTEGER NOT NULL,
    updated INTEGER NOT NULL, PRIMARY KEY (account, kind))`,
];

/** A live state older than this means the game (or the PC app) is gone. */
export const LIVE_FRESH_MS = 90_000;

export type LiveGame = {
  champion: string;
  championId: string;
  /** When the game clock read 0:00, ms since 1970, so the phone can tick the clock on its own. */
  startedAt: number;
  level: number;
  kills: number;
  deaths: number;
  assists: number;
  /** The next augment level (1, 7, 11, 15), null after the last. */
  nextAugment: number | null;
  /** True while an augment pick is waiting. */
  augmentReady: boolean;
  /** The next items to buy, by name, at most 2. */
  nextItems: string[];
  /** The owner's own predicted chance to win, 0-1 (owner only, as in the PC app), or null. */
  winChance: number | null;
  dead: boolean;
};

const int = (v: unknown, max: number) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Math.round(Number(v)))) : 0);
const text = (v: unknown, max = 40) => (typeof v === "string" ? v.replace(/[<>\p{C}]/gu, "").slice(0, max) : "");

/** What the PC app sent, reduced to the fields above; null if it isn't a live game. */
export function cleanLive(raw: unknown, now = Date.now()): LiveGame | null {
  if (!raw || typeof raw !== "object") return null;
  const g = raw as Record<string, unknown>;
  const champion = text(g.champion);
  const startedAt = int(g.startedAt, 1e14);
  // A game can't start in the future or more than 2 hours ago.
  if (!champion || startedAt > now + 60_000 || startedAt < now - 7_200_000) return null;
  const next = int(g.nextAugment, 18);
  const win = Number(g.winChance);
  return {
    champion,
    championId: text(g.championId) || champion.replace(/[^A-Za-z]/g, ""),
    startedAt,
    level: Math.max(1, int(g.level, 18)),
    kills: int(g.kills, 999),
    deaths: int(g.deaths, 999),
    assists: int(g.assists, 999),
    nextAugment: [1, 7, 11, 15].includes(next) ? next : null,
    augmentReady: g.augmentReady === true,
    nextItems: (Array.isArray(g.nextItems) ? g.nextItems : []).map((x) => text(x)).filter(Boolean).slice(0, 2),
    winChance: g.winChance === null || g.winChance === undefined || !Number.isFinite(win) ? null : Math.max(0, Math.min(1, Math.round(win * 100) / 100)),
    dead: g.dead === true,
  };
}

async function table() {
  const d = await db();
  await d.batch(SCHEMA.map((s) => d.prepare(s)));
  return d;
}

/** Saves the live game, or clears it when the game ended (live null). */
export async function saveLive(account: string, live: LiveGame | null) {
  const d = await table();
  if (!live) await d.prepare("DELETE FROM widget_live WHERE account = ?").bind(account).run();
  else
    await d
      .prepare("INSERT INTO widget_live (account, data, updated) VALUES (?, ?, ?) ON CONFLICT(account) DO UPDATE SET data = excluded.data, updated = excluded.updated")
      .bind(account, JSON.stringify(live), Date.now())
      .run();
}

/** The live game if the PC app posted it recently. */
export async function currentLive(account: string, now = Date.now()): Promise<LiveGame | null> {
  const row = await (await table()).prepare("SELECT data, updated FROM widget_live WHERE account = ?").bind(account).first<{ data: string; updated: number }>();
  return row && now - row.updated < LIVE_FRESH_MS ? (JSON.parse(row.data) as LiveGame) : null;
}

export type PushKind = "start" | "activity";
export const isPushKind = (v: unknown): v is PushKind => v === "start" || v === "activity";

export async function savePushToken(account: string, kind: PushKind, token: string | null, sandbox: boolean) {
  const d = await table();
  if (!token) await d.prepare("DELETE FROM widget_push WHERE account = ? AND kind = ?").bind(account, kind).run();
  else
    await d
      .prepare(
        "INSERT INTO widget_push (account, kind, token, sandbox, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT(account, kind) DO UPDATE SET token = excluded.token, sandbox = excluded.sandbox, updated = excluded.updated",
      )
      .bind(account, kind, token, sandbox ? 1 : 0, Date.now())
      .run();
}

export async function pushTokens(account: string): Promise<Partial<Record<PushKind, { token: string; sandbox: boolean }>>> {
  const { results } = await (await table()).prepare("SELECT kind, token, sandbox FROM widget_push WHERE account = ?").bind(account).all<{ kind: string; token: string; sandbox: number }>();
  return Object.fromEntries(results.filter((r) => isPushKind(r.kind)).map((r) => [r.kind, { token: r.token, sandbox: r.sandbox === 1 }]));
}
