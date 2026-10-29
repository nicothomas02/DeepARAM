import "server-only";
import { AccountError, db } from "./accounts";
import { sha256, type SessionAccount } from "./account-session";

// Contact us: a visitor types a message in the footer's box and the site owner reads it on /account.
// The site can't send email, so messages wait in the PROFILES D1 database. The sender's address is
// stored only if they give one for a reply; their IP is kept as a hash, only to cap messages per day.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS contact_messages (id TEXT PRIMARY KEY, message TEXT NOT NULL, reply_to TEXT, page TEXT,
    account TEXT, sender TEXT, created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS contact_messages_sender ON contact_messages (sender, created_at)`,
];

const MAX_PER_DAY = 5; // per sender, in the last 24 hours
export const MIN_LENGTH = 5;
export const MAX_LENGTH = 2000;

let ready: Promise<void> | null = null;
async function contactDb() {
  const d = await db();
  ready ??= d.batch(SCHEMA.map((s) => d.prepare(s))).then(
    () => undefined,
    (e) => {
      ready = null;
      throw e;
    },
  );
  await ready;
  return d;
}

export type ContactMessage = { message: string; replyTo: string | null; page: string | null };

export function cleanMessage(body: Record<string, unknown>): ContactMessage {
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message.length < MIN_LENGTH) throw new AccountError("Write a little more first.");
  if (message.length > MAX_LENGTH) throw new AccountError("That's too long. Keep it under 2,000 characters.");
  const raw = typeof body.replyTo === "string" ? body.replyTo.trim() : "";
  // The inbox replies through a mailto: link, so the address can't carry what would add headers or
  // recipients to it (?, &, %, /, commas, semicolons); the rest of an address is letters, digits and . _ + -.
  if (raw && (raw.length > 200 || !/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(raw))) throw new AccountError("That email address doesn't look right.");
  const page = typeof body.page === "string" && body.page.startsWith("/") ? body.page.slice(0, 200) : null;
  return { message, replyTo: raw || null, page };
}

export async function sendMessage(m: ContactMessage, from: { account: SessionAccount | null; ip: string | null }) {
  const d = await contactDb();
  const sender = await sha256(from.account ? `account:${from.account.id}` : `ip:${from.ip ?? "unknown"}`);
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const sent = await d.prepare("SELECT COUNT(*) AS n FROM contact_messages WHERE sender = ? AND created_at > ?").bind(sender, since).first<{ n: number }>();
  if ((sent?.n ?? 0) >= MAX_PER_DAY) throw new AccountError("That's 5 messages today. Try again tomorrow, or email us.", 429);
  await d
    .prepare("INSERT INTO contact_messages (id, message, reply_to, page, account, sender, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(crypto.randomUUID(), m.message, m.replyTo, m.page, from.account?.id ?? null, sender, new Date().toISOString())
    .run();
}

type Row = {
  id: string;
  message: string;
  reply_to: string | null;
  page: string | null;
  account: string | null;
  created_at: string;
  name: string | null;
  email: string | null;
};

/** The owner's inbox, newest first, with the sender's display name and email when they were signed in. */
export async function inbox(a: SessionAccount) {
  if (!a.owner) throw new AccountError("Only the site owner can read messages.", 403);
  const d = await contactDb();
  const r = await d
    .prepare(
      `SELECT m.*, p.name AS name, acc.email AS email FROM contact_messages m
       LEFT JOIN account_profile p ON p.account = m.account LEFT JOIN accounts acc ON acc.id = m.account
       ORDER BY m.created_at DESC LIMIT 100`,
    )
    .all<Row>();
  return r.results.map((m) => ({ id: m.id, message: m.message, replyTo: m.reply_to ?? m.email, page: m.page, by: m.name, created: m.created_at }));
}

export async function removeMessage(a: SessionAccount, id: string) {
  if (!a.owner) throw new AccountError("Only the site owner can delete messages.", 403);
  await (await contactDb()).prepare("DELETE FROM contact_messages WHERE id = ?").bind(id).run();
}
