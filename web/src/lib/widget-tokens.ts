import "server-only";
import { db } from "./accounts";
import { sha256 } from "./account-session";

// Tokens for the iPhone widgets (/api/widget). A widget runs outside the app's web view, so it can't use the
// sign-in cookie; the app trades the cookie for one of these once and keeps it in the iPhone keychain. A token
// only reads the widget summary of the account that made it (owner only), and is stored as its SHA-256 like
// sessions. Signing out of the app's widgets, or making a new token on the same device, deletes the old one.
// Data: the PROFILES D1 database.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS widget_tokens (id TEXT PRIMARY KEY, account TEXT NOT NULL, device TEXT NOT NULL, created INTEGER NOT NULL, used INTEGER)`,
  `CREATE INDEX IF NOT EXISTS widget_tokens_account ON widget_tokens (account)`,
];
/** At most this many devices per account; the oldest goes first. */
const MAX_DEVICES = 4;

async function table() {
  const d = await db();
  await d.batch(SCHEMA.map((s) => d.prepare(s)));
  return d;
}

const randomToken = () =>
  btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

export const cleanDevice = (v: unknown) => (typeof v === "string" ? v.replace(/[^\w .'-]/g, "").slice(0, 40) : "") || "iPhone";

/** A new token for this account and device, replacing the device's old one. */
export async function createWidgetToken(account: string, device: string): Promise<string> {
  const d = await table();
  const token = randomToken();
  await d.batch([
    d.prepare("DELETE FROM widget_tokens WHERE account = ? AND device = ?").bind(account, device),
    d.prepare("INSERT INTO widget_tokens (id, account, device, created) VALUES (?, ?, ?, ?)").bind(await sha256(token), account, device, Date.now()),
    d
      .prepare("DELETE FROM widget_tokens WHERE account = ? AND id NOT IN (SELECT id FROM widget_tokens WHERE account = ? ORDER BY created DESC LIMIT ?)")
      .bind(account, account, MAX_DEVICES),
  ]);
  return token;
}

/** The owner account a widget token belongs to, or null. */
export async function widgetTokenAccount(token: string | null): Promise<string | null> {
  if (!token || !/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const d = await table();
  const id = await sha256(token);
  const row = await d
    .prepare("SELECT t.account FROM widget_tokens t JOIN accounts a ON a.id = t.account WHERE t.id = ? AND a.owner = 1")
    .bind(id)
    .first<{ account: string }>();
  if (row) await d.prepare("UPDATE widget_tokens SET used = ? WHERE id = ?").bind(Date.now(), id).run();
  return row?.account ?? null;
}

export async function deleteWidgetToken(token: string) {
  await (await table()).prepare("DELETE FROM widget_tokens WHERE id = ?").bind(await sha256(token)).run();
}

/** The token in an "Authorization: Bearer ..." header, or null. */
export const bearerToken = (req: Request) => /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;
