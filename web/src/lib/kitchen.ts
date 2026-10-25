import "server-only";
import CHAMPIONS from "@/data/champion-names.json";
import { AccountError, db } from "./accounts";
import type { SessionAccount } from "./account-session";

// Community builds for The Kitchen: a signed-in player sends a build from the Simulator, the site owner
// approves it on /account, and approved builds show in The Kitchen's Community section with the
// player's display name. No stats are shown (the Simulator's numbers are kept for review only).
// Data: the PROFILES D1 database, next to the accounts it belongs to.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS kitchen_submissions (id TEXT PRIMARY KEY, account TEXT NOT NULL, champion TEXT NOT NULL,
    build TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL, sim TEXT, lang TEXT, status TEXT NOT NULL,
    created_at TEXT NOT NULL, reviewed_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS kitchen_submissions_account ON kitchen_submissions (account)`,
  `CREATE INDEX IF NOT EXISTS kitchen_submissions_status ON kitchen_submissions (status, created_at)`,
];

const MAX_PENDING = 3; // per player, waiting for review
const MAX_PER_DAY = 10; // per player, sent in the last 24 hours

export type Part = { key: string; id: number; name: string };
export type Submission = { champion: string; items: Part[]; augments: Part[]; title: string; description: string; sim: unknown; lang: string | null };

const text = (raw: unknown) => (typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "");
const unsafe = (s: string) => /[<>\p{C}]/u.test(s);

function parts(body: Record<string, unknown>, kind: "items" | "augments", min: number, max: number, keyRe: RegExp): Part[] {
  const keys = body[kind], ids = body[kind === "items" ? "item_ids" : "augment_ids"], names = body[kind === "items" ? "item_names" : "augment_names"];
  const label = kind === "items" ? "items" : "augments";
  if (!Array.isArray(keys) || !Array.isArray(ids) || !Array.isArray(names) || keys.length !== ids.length || keys.length !== names.length)
    throw new AccountError(`The build's ${label} are missing.`);
  if (keys.length < min || keys.length > max) throw new AccountError(min ? `Send 1 to ${max} ${label}.` : `Send at most ${max} ${label}.`);
  const out = keys.map((k, i) => ({ key: String(k), id: Number(ids[i]), name: text(names[i]) }));
  for (const p of out) {
    if (!keyRe.test(p.key) || !Number.isInteger(p.id) || p.id <= 0 || !p.name || p.name.length > 40 || unsafe(p.name))
      throw new AccountError(`One of the build's ${label} isn't valid.`);
  }
  if (new Set(out.map((p) => p.key)).size !== out.length) throw new AccountError(`The build lists the same ${kind === "items" ? "item" : "augment"} twice.`);
  return out;
}

/** Checks a submission body from the Simulator; throws an AccountError whose message the player sees. */
export function cleanSubmission(body: Record<string, unknown>): Submission {
  const champion = typeof body.champion === "string" ? body.champion : "";
  if (!/^[A-Za-z0-9]{2,24}$/.test(champion) || !(champion in CHAMPIONS)) throw new AccountError("Pick a champion first.");
  const items = parts(body, "items", 1, 6, /^[a-z0-9_]{2,48}$/);
  const augments = parts(body, "augments", 0, 4, /^[a-z0-9_]{2,48}$/);
  const title = text(body.title);
  if (title.length < 3 || title.length > 60) throw new AccountError("Give the build a name of 3 to 60 characters.");
  const description = text(body.description);
  if (description.length < 20 || description.length > 280) throw new AccountError("Say why it works in 20 to 280 characters.");
  if (unsafe(title) || unsafe(description)) throw new AccountError("The name or text has characters it can't use.");
  const sim = body.sim && typeof body.sim === "object" && JSON.stringify(body.sim).length <= 1000 ? body.sim : null;
  const lang = typeof body.lang === "string" && /^[a-z]{2}(-[A-Z]{2})?$/.test(body.lang) ? body.lang : null;
  return { champion, items, augments, title, description, sim, lang };
}

let ready: Promise<void> | null = null;
async function kitchenDb() {
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

type Row = { id: string; account: string; champion: string; build: string; title: string; description: string; sim: string | null; status: string; created_at: string; reviewed_at: string | null; name?: string | null };

function view(r: Row, withSim = false) {
  const b = JSON.parse(r.build) as { items: Part[]; augments: Part[] };
  return {
    id: r.id,
    champion: r.champion,
    championName: (CHAMPIONS as Record<string, string>)[r.champion] ?? r.champion,
    items: b.items.map(({ id, name }) => ({ id, name })),
    augments: b.augments.map(({ id, name }) => ({ id, name })),
    title: r.title,
    description: r.description,
    status: r.status,
    created: r.created_at,
    ...(r.name !== undefined ? { by: r.name || null } : {}),
    ...(withSim && r.sim ? { sim: JSON.parse(r.sim) } : {}),
  };
}

export async function submit(a: SessionAccount, s: Submission) {
  const d = await kitchenDb();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const counts = await d
    .prepare("SELECT SUM(status = 'pending') AS pending, SUM(created_at > ?) AS today FROM kitchen_submissions WHERE account = ?")
    .bind(since, a.id)
    .first<{ pending: number | null; today: number | null }>();
  if ((counts?.pending ?? 0) >= MAX_PENDING) throw new AccountError("You already have 3 builds waiting for review. Try again once they're checked.", 429);
  if ((counts?.today ?? 0) >= MAX_PER_DAY) throw new AccountError("That's 10 builds today. Try again tomorrow.", 429);
  const id = crypto.randomUUID();
  await d
    .prepare("INSERT INTO kitchen_submissions (id, account, champion, build, title, description, sim, lang, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)")
    .bind(id, a.id, s.champion, JSON.stringify({ items: s.items, augments: s.augments }), s.title, s.description, s.sim ? JSON.stringify(s.sim) : null, s.lang, new Date().toISOString())
    .run();
  return { id, status: "pending" };
}

/** The player's own submissions, and for the site owner the review queue (with the Simulator's numbers). */
export async function mine(a: SessionAccount) {
  const d = await kitchenDb();
  const own = await d.prepare("SELECT * FROM kitchen_submissions WHERE account = ? ORDER BY created_at DESC LIMIT 50").bind(a.id).all<Row>();
  const out: { mine: ReturnType<typeof view>[]; queue?: ReturnType<typeof view>[] } = { mine: own.results.map((r) => view(r)) };
  if (a.owner) {
    const q = await d
      .prepare("SELECT s.*, p.name AS name FROM kitchen_submissions s LEFT JOIN account_profile p ON p.account = s.account WHERE s.status = 'pending' ORDER BY s.created_at LIMIT 100")
      .all<Row>();
    out.queue = q.results.map((r) => view(r, true));
  }
  return out;
}

/** Approved builds for The Kitchen's Community section, newest first. Only the display name says who sent it. */
export async function community() {
  const d = await kitchenDb();
  const r = await d
    .prepare("SELECT s.*, p.name AS name FROM kitchen_submissions s LEFT JOIN account_profile p ON p.account = s.account WHERE s.status = 'approved' ORDER BY s.reviewed_at DESC LIMIT 60")
    .all<Row>();
  return r.results.map((x) => {
    const { status: _status, ...v } = view(x);
    return v;
  });
}

/** A player deletes their own build; the owner can delete any. */
export async function remove(a: SessionAccount, id: string) {
  const d = await kitchenDb();
  const r = await d.prepare("SELECT account FROM kitchen_submissions WHERE id = ?").bind(id).first<{ account: string }>();
  if (!r || (r.account !== a.id && !a.owner)) throw new AccountError("That build isn't there.", 404);
  await d.prepare("DELETE FROM kitchen_submissions WHERE id = ?").bind(id).run();
}

export async function review(a: SessionAccount, id: string, action: unknown) {
  if (!a.owner) throw new AccountError("Only the site owner can review builds.", 403);
  if (action !== "approve" && action !== "reject") throw new AccountError("Approve or reject.");
  const d = await kitchenDb();
  await d
    .prepare("UPDATE kitchen_submissions SET status = ?, reviewed_at = ? WHERE id = ?")
    .bind(action === "approve" ? "approved" : "rejected", new Date().toISOString(), id)
    .run();
}
