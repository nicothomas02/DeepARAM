import { NextRequest } from "next/server";
import { d1 } from "@/lib/env";
import { passesBotCheck } from "@/lib/bot-check";

// The Simulator leaderboard (SIM database, table submissions): the top 10 builds visitors have simulated.
// POST /api/sim-scores {champion, items, augments, dps}: the replay page sends every build it simulates on the
//   live patch, on its own. Only the build is stored, never who sent it (ip_hash is a per-day hash used for the
//   daily limit). It is stored as "pending" and the sent damage is never shown: the simulator re-runs every
//   pending build on our side (simulator/tools/verify_leaderboard.py) and only that result counts. Rows then
//   are "verified" (in the top 10), "checked" (simulated, outside the top 10) or "rejected". The same job
//   re-runs the top 10 every few hours and removes a build that no longer works (an item or augment gone).
//   One row per build; repeats are ignored. The page also sends {check}, the bot-check token
//   (lib/bot-check.ts), once that check is switched on.
// GET /api/sim-scores: the top 10 builds, best first.
const MAX_BODY = 5_000; // the bot-check token can be 2,048 characters
const PER_IP_PER_DAY = 50;
const TOP = 10;
const MAX_PENDING = 3_000;
const CHAMP = /^[A-Za-z0-9]{2,24}$/;
const KEY = /^[a-z0-9_]{2,48}$/;

const json = (obj: unknown, status = 200, cache = "no-store") => Response.json(obj, { status, headers: { "Cache-Control": cache } });

function keys(v: unknown, max: number): string[] | null {
  if (!Array.isArray(v) || v.length > max || !v.every((k) => typeof k === "string" && KEY.test(k))) return null;
  return new Set(v).size === v.length ? (v as string[]) : null;
}

async function ipHash(req: NextRequest) {
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  // The day is part of the hash, so the same visitor can't be followed from one day to the next.
  const day = new Date().toISOString().slice(0, 10);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`sim:${day}:${ip}`));
  return [...new Uint8Array(hash).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function POST(req: NextRequest) {
  const db = d1("SIM");
  if (!db) return json({ error: "The leaderboard isn't available right now." }, 503);
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: "Too large" }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const champion = body?.champion;
  const items = keys(body?.items, 6);
  const augments = keys(body?.augments ?? [], 4);
  const dps = Number(body?.dps);
  if (typeof champion !== "string" || !CHAMP.test(champion) || !items || !items.length || !augments)
    return json({ error: "Bad request" }, 400);

  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (!(await passesBotCheck(body?.check, ip))) return json({ error: "The bot check didn't pass. Try again." }, 403);

  const buildKey = [champion.toLowerCase(), [...items].sort().join(","), [...augments].sort().join(",")].join("|");
  const known = await db
    .prepare("SELECT status, verified_dps FROM submissions WHERE build_key = ? LIMIT 1")
    .bind(buildKey)
    .first<{ status: string; verified_dps: number | null }>();
  if (known) return json({ status: known.status, verified_dps: known.verified_dps, repeat: true });

  const hashed = await ipHash(req);
  const counts = await db
    .prepare(
      "SELECT (SELECT COUNT(*) FROM submissions WHERE ip_hash = ? AND created > datetime('now', '-1 day')) AS mine, " +
        "(SELECT COUNT(*) FROM submissions WHERE status = 'pending') AS pending",
    )
    .bind(hashed)
    .first<{ mine: number; pending: number }>();
  if ((counts?.mine ?? 0) >= PER_IP_PER_DAY) return json({ error: "That's a lot of builds for one day. Try again tomorrow." }, 429);
  if ((counts?.pending ?? 0) >= MAX_PENDING) return json({ error: "Lots of builds are waiting to be checked. Try again later." }, 503);

  await db
    .prepare(
      "INSERT OR IGNORE INTO submissions (champion, items, augments, build_key, patch, claimed_dps, ip_hash, created) " +
        "VALUES (?, ?, ?, ?, '', ?, ?, datetime('now'))",
    )
    .bind(champion, items.join(","), augments.join(","), buildKey, Number.isFinite(dps) ? dps : null, hashed)
    .run();
  return json({ status: "pending" }, 202);
}

type Row = { champion: string; items: string; augments: string; verified_dps: number; survival: number; time_alive: number; patch: string };
const shape = (r: Row) => ({
  champion: r.champion,
  items: r.items.split(",").filter(Boolean),
  augments: r.augments.split(",").filter(Boolean),
  dps: r.verified_dps,
  survival: r.survival,
  time_alive: r.time_alive,
  patch: r.patch,
});

export async function GET() {
  const db = d1("SIM");
  if (!db) return json({ builds: [] }, 200);
  const rows = (
    await db
      .prepare(
        "SELECT champion, items, augments, verified_dps, survival, time_alive, patch FROM submissions " +
          "WHERE status = 'verified' ORDER BY verified_dps DESC LIMIT ?",
      )
      .bind(TOP)
      .all<Row>()
  ).results;
  return json({ builds: rows.map(shape) }, 200, "public, max-age=60, s-maxage=300");
}
