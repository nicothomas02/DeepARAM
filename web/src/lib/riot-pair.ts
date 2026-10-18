import "server-only";
import { AccountError, connectRiot, db } from "./accounts";

// One-click connect from My Stats: the helper on the player's computer starts a request with the Riot Client's
// sign-in, opens deeparam.com/account?connect=<id>, and the signed-in player confirms it there. Nothing is
// copied by hand. The id is a long random secret that only that browser tab sees; the page names the Riot
// account before connecting, and the helper learns the outcome by asking again with the same Riot sign-in.
// Data: the PROFILES D1 database, next to the accounts it connects.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS riot_pairs (id TEXT PRIMARY KEY, puuid TEXT NOT NULL, riot_name TEXT NOT NULL,
    platform TEXT NOT NULL, expires INTEGER NOT NULL, account TEXT, save INTEGER NOT NULL DEFAULT 0)`,
];
const TTL = 30 * 60_000;
export const isPairId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{32}$/.test(v);

async function table() {
  const d = await db();
  await d.batch(SCHEMA.map((s) => d.prepare(s)));
  return d;
}

/** Starts a connect request for the Riot account signed in on the player's computer. */
export async function startPair(riot: { puuid: string; name: string; tag: string }, platform: string): Promise<string> {
  const d = await table();
  const id = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, "-").replace(/\//g, "_");
  await d.batch([
    // One open request per Riot account; old ones go.
    d.prepare("DELETE FROM riot_pairs WHERE puuid = ? OR expires < ?").bind(riot.puuid, Date.now()),
    d.prepare("INSERT INTO riot_pairs (id, puuid, riot_name, platform, expires) VALUES (?, ?, ?, ?, ?)").bind(id, riot.puuid, `${riot.name}#${riot.tag}`, platform, Date.now() + TTL),
  ]);
  return id;
}

type Row = { puuid: string; riot_name: string; platform: string; account: string | null; save: number };

async function openPair(id: string): Promise<Row | null> {
  return (await table()).prepare("SELECT puuid, riot_name, platform, account, save FROM riot_pairs WHERE id = ? AND expires > ?").bind(id, Date.now()).first<Row>();
}

/** What the account page shows before the player confirms: whose Riot account it is. */
export async function pairInfo(id: string) {
  const row = await openPair(id);
  return row ? { riotId: row.riot_name, done: !!row.account } : null;
}

/** The signed-in player confirms: connects the Riot account, and notes whether My Stats should save their games. */
export async function confirmPair(id: string, account: { id: string; owner: boolean }, save: boolean) {
  const row = await openPair(id);
  if (!row) throw new AccountError("This connect link has expired. Choose Connect account in My Stats again.", 410);
  const [name, tag] = [row.riot_name.slice(0, row.riot_name.lastIndexOf("#")), row.riot_name.slice(row.riot_name.lastIndexOf("#") + 1)];
  await connectRiot(account.id, { puuid: row.puuid, name, tag }, row.platform);
  // Saving games to the account is for the owner's account only (lib/match-history.ts).
  await (await table()).prepare("UPDATE riot_pairs SET account = ?, save = ? WHERE id = ?").bind(account.id, save && account.owner ? 1 : 0, id).run();
  return { riotId: row.riot_name };
}

/** The helper asks how its request went; only the same Riot account can ask. */
export async function pairStatus(id: string, puuid: string) {
  const row = await openPair(id);
  if (!row || row.puuid !== puuid) return { expired: true };
  if (!row.account) return { linked: false };
  await (await table()).prepare("DELETE FROM riot_pairs WHERE id = ?").bind(id).run();
  return { linked: true, riotId: row.riot_name, save: row.save === 1 };
}
