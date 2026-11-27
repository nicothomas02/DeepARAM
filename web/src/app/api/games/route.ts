import { NextRequest } from "next/server";
import { isPlatform, tokenOwner } from "@/lib/profiles";
import { livePatch } from "@/lib/highlights";
import { cleanGame, relinkSharer, sharedCount, sharedTotals, shareGames, unshareGames } from "@/lib/shared-games";

// POST /api/games {action: "share" | "remove" | "status", key | (token, platform), games?}, sent by the desktop app or
// the My Stats helper for players who turned sharing on. The key or token only ties a player's shares together; see
// lib/shared-games.ts.
// GET /api/games → {all, patch}: how many shared games the site holds, in all and on the live patch.
const MAX_BODY = 600_000;
const MAX_GAMES = 50;

const json = (obj: unknown, status = 200) => Response.json(obj, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  try {
    return Response.json(await sharedTotals(livePatch()), { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    return json({ all: null, patch: null });
  }
}

export async function POST(req: NextRequest) {
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: "Too large" }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const { action, token, platform, key } = body ?? {};
  // The desktop app (0.3.15+) sends a random key it made and keeps, never a Riot sign-in token (Riot's developer
  // policies, Nico 2026-11-27). The key only ties a player's shares together so "off" can remove them. Older apps
  // and the My Stats helper still send the League client's token, checked with Riot.
  let owner: { puuid: string } | null = null;
  // "migrate" (once per app, when it switches from the token to its key): proves the account one last time with the
  // token and moves what it shared before to the key, so turning sharing off still removes everything.
  if (action === "migrate") {
    if (typeof key !== "string" || !/^[0-9a-f]{64}$/.test(key) || typeof token !== "string" || !isPlatform(platform)) return json({ error: "Bad request" }, 400);
    const was = await tokenOwner(token, platform);
    if (!was) return json({ error: "Couldn't confirm your account." }, 401);
    return json({ shared: await relinkSharer(was.puuid, key) });
  }
  if (typeof key === "string") {
    if (!/^[0-9a-f]{64}$/.test(key)) return json({ error: "Bad request" }, 400);
    owner = { puuid: `key:${key}` };
  } else {
    if (typeof token !== "string" || !isPlatform(platform)) return json({ error: "Bad request" }, 400);
    owner = await tokenOwner(token, platform);
  }
  if (!owner) return json({ error: "Couldn't confirm your account. Make sure the Riot Client is open and signed in." }, 401);

  if (action === "remove") {
    await unshareGames(owner.puuid);
    return json({ shared: 0 });
  }
  if (action === "share") {
    const raw = Array.isArray(body.games) ? body.games.slice(0, MAX_GAMES) : [];
    const games = (await Promise.all(raw.map(cleanGame))).filter((g) => g !== null);
    return json({ accepted: games.length, shared: await shareGames(owner.puuid, games) });
  }
  return json({ shared: await sharedCount(owner.puuid) });
}
