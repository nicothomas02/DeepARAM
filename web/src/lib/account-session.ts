import { getCloudflareContext } from "@opennextjs/cloudflare";

// The part of site accounts the middleware needs too (so no "server-only" here): the tables, and which
// account a session cookie belongs to. Everything else is in lib/accounts.ts. Data: the PROFILES D1 database.

type Stmt = {
  bind(...v: unknown[]): Stmt;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
};
export type DB = { prepare(sql: string): Stmt; batch(s: Stmt[]): Promise<unknown> };

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE, pass TEXT, owner INTEGER NOT NULL DEFAULT 0,
    data TEXT NOT NULL DEFAULT '{}', riot_puuid TEXT UNIQUE, riot_name TEXT, riot_platform TEXT, created_at TEXT NOT NULL)`,
  // At most one owner, whatever happens between two requests.
  `CREATE UNIQUE INDEX IF NOT EXISTS accounts_one_owner ON accounts (owner) WHERE owner = 1`,
  `CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, account TEXT NOT NULL, method TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS sessions_account ON sessions (account)`,
  `CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, account TEXT NOT NULL, public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0,
    transports TEXT, label TEXT, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS passkeys_account ON passkeys (account)`,
  `CREATE TABLE IF NOT EXISTS link_codes (code TEXT PRIMARY KEY, account TEXT NOT NULL, expires INTEGER NOT NULL)`,
  // Sign in with Google, Apple, Discord and the rest (lib/oauth.ts): which provider account opens which site account.
  `CREATE TABLE IF NOT EXISTS logins (provider TEXT NOT NULL, subject TEXT NOT NULL, account TEXT NOT NULL, email TEXT, created_at TEXT NOT NULL,
    PRIMARY KEY (provider, subject))`,
  `CREATE INDEX IF NOT EXISTS logins_account ON logins (account)`,
  // What the account looks like on its own page: a display name and a champion icon.
  `CREATE TABLE IF NOT EXISTS account_profile (account TEXT PRIMARY KEY, name TEXT, icon TEXT)`,
];

let ready: Promise<void> | null = null;

/** The accounts database with its tables in place, or null outside Cloudflare. */
export async function accountsDb(): Promise<DB | null> {
  let db: DB | null = null;
  try {
    db = ((getCloudflareContext().env as unknown as Record<string, unknown>).PROFILES as DB) ?? null;
  } catch {
    return null;
  }
  if (!db) return null;
  ready ??= db.batch(SCHEMA.map((s) => db.prepare(s))).then(
    () => undefined,
    (e) => {
      ready = null;
      throw e;
    },
  );
  await ready;
  return db;
}

export async function sha256(text: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type SessionAccount = { id: string; email: string | null; owner: boolean; method: string; created: number };

/** The signed-in account for a session cookie value, or null (no cookie, expired, or signed out). */
export async function sessionAccount(token: string | undefined): Promise<SessionAccount | null> {
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const db = await accountsDb().catch(() => null);
  if (!db) return null;
  const row = await db
    .prepare("SELECT a.id, a.email, a.owner, s.method, s.created FROM sessions s JOIN accounts a ON a.id = s.account WHERE s.id = ? AND s.expires > ?")
    .bind(await sha256(token), Date.now())
    .first<{ id: string; email: string | null; owner: number; method: string; created: number }>();
  return row ? { id: row.id, email: row.email, owner: row.owner === 1, method: row.method, created: row.created } : null;
}
