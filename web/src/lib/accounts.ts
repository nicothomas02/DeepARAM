import "server-only";
import type { NextResponse } from "next/server";
import { CHALLENGE_COOKIE, OWNER_FLAG, SESSION_COOKIE, SESSION_DAYS, SIGNED_IN_FLAG } from "./account-cookies";
import { accountsDb, sessionAccount, sha256, type DB, type SessionAccount } from "./account-session";
import { profileByPuuid, profilePath } from "./profiles";
import { enabledProviders, PROVIDER_NAMES, type Identity, type Provider } from "./oauth";
import { DEFAULT_SETTINGS } from "./settings";
import { serverEnv } from "./env";
import CHAMPIONS from "@/data/champion-names.json";

// Site accounts: sign in with an email and password or a passkey, and settings follow
// you to every browser you sign in on. Passwords are stored as salted PBKDF2 hashes, sessions as the
// SHA-256 of a random token. One account can be the site owner (the site editor).
// A Riot account is connected through Mayhem Stats, which confirms it with the Riot Client (lib/riot-pair.ts).

export class AccountError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export async function db(): Promise<DB> {
  const d = await accountsDb().catch(() => null);
  if (!d) throw new AccountError("Accounts aren't available right now. Try again later.", 503);
  return d;
}

// ---- Passwords ----

const ITERATIONS = 100_000; // the most Cloudflare Workers allow for PBKDF2
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(await pbkdf2(password, salt, ITERATIONS))}`;
}

export async function checkPasswordHash(password: string, stored: string | null): Promise<boolean> {
  const [kind, iter, salt, hash] = (stored ?? "").split("$");
  if (kind !== "pbkdf2" || !salt || !hash) return false;
  const got = await pbkdf2(password, unb64(salt), Number(iter));
  const want = unb64(hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ want[i];
  return diff === 0;
}

export function cleanEmail(raw: unknown): string {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AccountError("Enter a valid email address.");
  return email;
}

export function cleanPassword(raw: unknown): string {
  const pw = typeof raw === "string" ? raw : "";
  if (pw.length < 10) throw new AccountError("Use at least 10 characters for your password.");
  if (pw.length > 200) throw new AccountError("That password is too long.");
  return pw;
}

// ---- Sessions ----

const randomToken = () => b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const ownerEmail = () => serverEnv("OWNER_EMAIL")?.trim().toLowerCase() || null;

/**
 * The site owner (site editor) is the account whose email is the OWNER_EMAIL secret. The email
 * lives only in that secret, never in the code. Brings the stored flag in line and says whether this account is it.
 */
export async function syncOwner(id: string): Promise<boolean> {
  const want = ownerEmail();
  const d = await db();
  const row = await d.prepare("SELECT email, owner FROM accounts WHERE id = ?").bind(id).first<{ email: string | null; owner: number }>();
  const owner = Boolean(want && row?.email && row.email === want);
  if (row && owner !== (row.owner === 1)) {
    if (owner) await d.batch([d.prepare("UPDATE accounts SET owner = 0 WHERE owner = 1 AND id != ?").bind(id), d.prepare("UPDATE accounts SET owner = 1 WHERE id = ?").bind(id)]);
    else await d.prepare("UPDATE accounts SET owner = 0 WHERE id = ?").bind(id).run();
  }
  return owner;
}

/** Starts a session and sets its cookies on the response. */
export async function startSession(res: NextResponse, account: { id: string }, method: "password" | "passkey" | Provider, secure: boolean) {
  const d = await db();
  const owner = await syncOwner(account.id);
  const token = randomToken();
  const now = Date.now();
  const expires = now + SESSION_DAYS * 86_400_000;
  await d.batch([
    d.prepare("INSERT INTO sessions (id, account, method, created, expires) VALUES (?, ?, ?, ?, ?)").bind(await sha256(token), account.id, method, now, expires),
    d.prepare("DELETE FROM sessions WHERE expires < ?").bind(now),
  ]);
  const opts = { path: "/", maxAge: SESSION_DAYS * 86_400, sameSite: "lax" as const, secure };
  res.cookies.set(SESSION_COOKIE, token, { ...opts, httpOnly: true });
  res.cookies.set(SIGNED_IN_FLAG, "1", opts);
  if (owner) res.cookies.set(OWNER_FLAG, "1", opts);
  else res.cookies.delete(OWNER_FLAG);
}

export function clearSessionCookies(res: NextResponse) {
  for (const c of [SESSION_COOKIE, SIGNED_IN_FLAG, OWNER_FLAG, CHALLENGE_COOKIE]) res.cookies.delete(c);
}

export async function endSession(token: string | undefined) {
  if (!token) return;
  await (await db()).prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256(token)).run();
}

/** For route handlers and server pages: the signed-in account, or null. */
export async function currentAccount(): Promise<SessionAccount | null> {
  const { cookies } = await import("next/headers");
  return sessionAccount((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function requireAccount(): Promise<SessionAccount> {
  const a = await currentAccount();
  if (!a) throw new AccountError("Sign in first.", 401);
  return a;
}

// ---- Accounts ----

type Row = { id: string; email: string | null; pass: string | null; owner: number; data: string; riot_puuid: string | null; riot_name: string | null; riot_platform: string | null };

export async function createAccount(email: string, password: string): Promise<{ id: string; owner: boolean }> {
  const d = await db();
  if (await d.prepare("SELECT 1 FROM accounts WHERE email = ?").bind(email).first()) throw new AccountError("There's already an account with that email. Sign in instead.", 409);
  const id = crypto.randomUUID();
  await d.prepare("INSERT INTO accounts (id, email, pass, created_at) VALUES (?, ?, ?, datetime('now'))").bind(id, email, await hashPassword(password)).run();
  return { id, owner: false };
}

export async function passwordSignIn(email: string, password: string): Promise<{ id: string; owner: boolean }> {
  const row = await (await db()).prepare("SELECT id, pass, owner FROM accounts WHERE email = ?").bind(email).first<Row>();
  // Hash even when there's no account, so the answer takes as long either way.
  const ok = await checkPasswordHash(password, row?.pass ?? "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
  if (!row || !ok) throw new AccountError("Wrong email or password.", 401);
  return { id: row.id, owner: row.owner === 1 };
}

export type AccountData = { settings: Record<string, unknown> };

/** Keeps only what the site saves: known settings with the right types. */
export function cleanData(raw: unknown): AccountData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const settings: Record<string, unknown> = {};
  const s = (r.settings && typeof r.settings === "object" ? r.settings : {}) as Record<string, unknown>;
  for (const [k, def] of Object.entries(DEFAULT_SETTINGS)) {
    const v = s[k];
    if (typeof v === typeof def && (typeof v !== "string" || v.length <= 20)) settings[k] = v;
  }
  return { settings };
}

/** Saves the synced settings. Anything else already stored with the account (old Favorites) is left as it is. */
export async function saveData(id: string, data: unknown) {
  // json_set keeps the rest of the stored object; json() makes the value an object, not a string.
  await (await db()).prepare("UPDATE accounts SET data = json_set(data, '$.settings', json(?)) WHERE id = ?").bind(JSON.stringify(cleanData(data).settings), id).run();
}

/** Everything the account page shows. */
export async function accountView(a: SessionAccount) {
  const d = await db();
  const row = await d.prepare("SELECT * FROM accounts WHERE id = ?").bind(a.id).first<Row>();
  if (!row) throw new AccountError("Sign in first.", 401);
  const keys = await d.prepare("SELECT id, label, created_at FROM passkeys WHERE account = ? ORDER BY created_at").bind(a.id).all<{ id: string; label: string | null; created_at: string }>();
  let data: AccountData = { settings: {} };
  try {
    data = cleanData(JSON.parse(row.data));
  } catch {}
  const profile = row.riot_puuid ? await profileByPuuid(row.riot_puuid).catch(() => null) : null;
  const look = await d.prepare("SELECT name, icon FROM account_profile WHERE account = ?").bind(a.id).first<{ name: string | null; icon: string | null }>();
  const logins = await d.prepare("SELECT provider, email FROM logins WHERE account = ? ORDER BY created_at").bind(a.id).all<{ provider: Provider; email: string | null }>();
  return {
    id: row.id,
    email: row.email,
    name: look?.name ?? null,
    icon: look?.icon ?? null,
    hasPassword: Boolean(row.pass),
    owner: await syncOwner(a.id),
    data,
    passkeys: keys.results.map((k) => ({ id: k.id, label: k.label ?? "Passkey", created: k.created_at })),
    riot: row.riot_name ? { name: row.riot_name, platform: row.riot_platform, page: profile ? profilePath(profile.platform, profile.name, profile.tag) : null } : null,
    // A password can be replaced without the old one right after a passkey sign-in (the "forgot password" route).
    passkeySession: a.method === "passkey" && Date.now() - a.created < 15 * 60_000,
    // Other sign-in services: the ones switched on, and the ones this account signs in with.
    providers: enabledProviders(),
    logins: logins.results.map((l) => ({ provider: l.provider, name: PROVIDER_NAMES[l.provider] ?? l.provider, email: l.email })),
  };
}

export async function changePassword(a: SessionAccount, current: unknown, next: string) {
  const d = await db();
  const row = await d.prepare("SELECT pass FROM accounts WHERE id = ?").bind(a.id).first<Row>();
  const fresh = a.method === "passkey" && Date.now() - a.created < 15 * 60_000;
  if (row?.pass && !fresh && !(typeof current === "string" && (await checkPasswordHash(current, row.pass)))) throw new AccountError("Your current password is wrong.", 401);
  await d.batch([
    d.prepare("UPDATE accounts SET pass = ? WHERE id = ?").bind(await hashPassword(next), a.id),
    // Other browsers signed in with the old password are signed out.
    d.prepare("DELETE FROM sessions WHERE account = ? AND method = 'password'").bind(a.id),
  ]);
}

/** A password check for changes that matter, skipped right after a fresh sign-in on an account with no password. */
export async function confirmIt(a: SessionAccount, password: unknown) {
  const row = await (await db()).prepare("SELECT pass FROM accounts WHERE id = ?").bind(a.id).first<{ pass: string | null }>();
  const recent = Date.now() - a.created < 15 * 60_000;
  if (row?.pass ? !(a.method === "passkey" && recent) && !(typeof password === "string" && (await checkPasswordHash(password, row.pass))) : !recent)
    throw new AccountError(row?.pass ? "Your password is wrong." : "Sign out and back in, then try again.", 401);
}

/** Display name (up to 24 characters) and champion icon. Empty clears either one. */
export async function saveProfile(id: string, raw: { name?: unknown; icon?: unknown }) {
  const name = typeof raw.name === "string" ? raw.name.replace(/\s+/g, " ").trim() : "";
  if (name.length > 24) throw new AccountError("Use 24 characters or fewer for your name.");
  if (/[<>\p{C}]/u.test(name)) throw new AccountError("That name has characters it can't use.");
  const icon = typeof raw.icon === "string" && raw.icon in CHAMPIONS ? raw.icon : null;
  await (await db())
    .prepare("INSERT INTO account_profile (account, name, icon) VALUES (?, ?, ?) ON CONFLICT (account) DO UPDATE SET name = excluded.name, icon = excluded.icon")
    .bind(id, name || null, icon)
    .run();
}

/** A new email for signing in. The owner's email can't be moved onto another account. */
export async function changeEmail(a: SessionAccount, email: string, password: unknown) {
  await confirmIt(a, password);
  const d = await db();
  if (email === ownerEmail()) throw new AccountError("That email can't be used here.", 403);
  if (await d.prepare("SELECT 1 FROM accounts WHERE email = ? AND id != ?").bind(email, a.id).first()) throw new AccountError("There's already an account with that email.", 409);
  await d.prepare("UPDATE accounts SET email = ? WHERE id = ?").bind(email, a.id).run();
  await syncOwner(a.id);
}

export async function deleteAccount(id: string) {
  const d = await db();
  await d.batch(["passkeys", "sessions", "link_codes", "logins", "account_profile"].map((t) => d.prepare(`DELETE FROM ${t} WHERE account = ?`).bind(id)).concat(d.prepare("DELETE FROM accounts WHERE id = ?").bind(id)));
  // Builds sent to The Kitchen (lib/kitchen.ts); the table exists only once someone has sent one.
  await d.prepare("DELETE FROM kitchen_submissions WHERE account = ?").bind(id).run().catch(() => undefined);
  // Games saved from My Stats (lib/match-history.ts), likewise.
  await d.prepare("DELETE FROM account_games WHERE account = ?").bind(id).run().catch(() => undefined);
}

// ---- Riot account (through My Stats) ----

function setRiot(d: DB, id: string, riot: { puuid: string; name: string; tag: string }, platform: string | null) {
  return d.batch([
    // A Riot account belongs to one site account at a time.
    d.prepare("UPDATE accounts SET riot_puuid = NULL, riot_name = NULL, riot_platform = NULL WHERE riot_puuid = ?").bind(riot.puuid),
    d.prepare("UPDATE accounts SET riot_puuid = ?, riot_name = ?, riot_platform = ? WHERE id = ?").bind(riot.puuid, `${riot.name}#${riot.tag}`, platform, id),
  ]);
}

/** Connects a Riot account (confirmed by My Stats with the Riot Client) to a site account. */
export async function connectRiot(id: string, riot: { puuid: string; name: string; tag: string }, platform: string | null) {
  await setRiot(await db(), id, riot, platform);
}

export async function unlinkRiot(id: string) {
  await (await db()).prepare("UPDATE accounts SET riot_puuid = NULL, riot_name = NULL, riot_platform = NULL WHERE id = ?").bind(id).run();
}

/** How many ways into an account there are, leaving out the one about to be removed. */
export async function waysIn(id: string, without: "passkey" | Provider, passkeyId?: string): Promise<number> {
  const d = await db();
  const row = await d
    .prepare(
      `SELECT (email IS NOT NULL AND pass IS NOT NULL) AS pw,
        (SELECT COUNT(*) FROM passkeys WHERE account = accounts.id AND id IS NOT ?) AS keys,
        (SELECT COUNT(*) FROM logins WHERE account = accounts.id AND provider IS NOT ?) AS logins
       FROM accounts WHERE id = ?`,
    )
    .bind(without === "passkey" ? (passkeyId ?? "") : null, without !== "passkey" ? without : null, id)
    .first<{ pw: number; keys: number; logins: number }>();
  if (!row) return 0;
  return row.pw + row.keys + row.logins;
}

// ---- Sign in with Google, Apple, Discord and the rest (lib/oauth.ts) ----

const MISMATCH = (p: Provider) => `That ${PROVIDER_NAMES[p]} account already signs in to a different DeepARAM account.`;

/** Signs in with another service: the site account it opens, or a new one for it. Never joins an existing account by email. */
export async function providerSignIn(p: Provider, who: Identity): Promise<{ id: string; owner: boolean }> {
  const d = await db();
  const row = await d
    .prepare("SELECT a.id, a.owner FROM logins l JOIN accounts a ON a.id = l.account WHERE l.provider = ? AND l.subject = ?")
    .bind(p, who.subject)
    .first<{ id: string; owner: number }>();
  if (row) return { id: row.id, owner: row.owner === 1 };
  const taken = who.email ? await d.prepare("SELECT 1 FROM accounts WHERE email = ?").bind(who.email).first() : null;
  const id = crypto.randomUUID();
  await d.batch([
    d.prepare("INSERT INTO accounts (id, email, created_at) VALUES (?, ?, datetime('now'))").bind(id, taken ? null : who.email),
    d.prepare("INSERT INTO logins (provider, subject, account, email, created_at) VALUES (?, ?, ?, ?, datetime('now'))").bind(p, who.subject, id, who.email),
  ]);
  return { id, owner: false };
}

/** Adds another service as a way into the signed-in account. */
export async function connectProvider(id: string, p: Provider, who: Identity) {
  const d = await db();
  const other = await d.prepare("SELECT account FROM logins WHERE provider = ? AND subject = ?").bind(p, who.subject).first<{ account: string }>();
  if (other && other.account !== id) throw new AccountError(MISMATCH(p), 409);
  await d.batch([
    // One account per service per site account.
    d.prepare("DELETE FROM logins WHERE account = ? AND provider = ?").bind(id, p),
    d.prepare("INSERT INTO logins (provider, subject, account, email, created_at) VALUES (?, ?, ?, ?, datetime('now'))").bind(p, who.subject, id, who.email),
  ]);
}

export async function disconnectProvider(id: string, p: Provider) {
  if ((await waysIn(id, p)) === 0) throw new AccountError(`Add a passkey first. ${PROVIDER_NAMES[p]} is the only way into this account.`, 409);
  await (await db()).prepare("DELETE FROM logins WHERE account = ? AND provider = ?").bind(id, p).run();
}
