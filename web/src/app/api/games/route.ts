import { NextRequest } from "next/server";
import { json, readBody } from "@/lib/api-body";
import { isMayhemQueue } from "@/lib/mayhem-queues";
import { isPlatform, tokenOwner } from "@/lib/profiles";
import { livePatch } from "@/lib/highlights";
import { cleanGame, sharedCount, sharedTotals, shareGames, unshareGames } from "@/lib/shared-games";

// POST /api/games {action: "share" | "remove" | "status", token, platform, games?}, sent by the My Stats
// helper for players who turned sharing on. The token only proves who is sharing; see lib/shared-games.ts.
// Only Mayhem games are kept (lib/mayhem-queues.ts), the same filter the importer applies.
// GET /api/games → {all, patch}: how many shared games the site holds, in all and on the live patch.
const MAX_BODY = 600_000;
const MAX_GAMES = 50;

export async function GET() {
  try {
    return Response.json(await sharedTotals(livePatch()), { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    return json({ all: null, patch: null });
  }
}

export async function POST(req: NextRequest) {
  const body = await readBody(req, MAX_BODY);
  if (body instanceof Response) return body;
  const { action, token, platform } = body;
  if (typeof token !== "string" || !token || !isPlatform(platform)) return json({ error: "Bad request" }, 400);
  if (action !== "share" && action !== "remove" && action !== "status") return json({ error: "Bad request" }, 400);
  if (action === "share" && !Array.isArray(body.games)) return json({ error: "Bad request" }, 400);
  const owner = await tokenOwner(token, platform);
  if (!owner) return json({ error: "Couldn't confirm your account. Make sure the Riot Client is open and signed in." }, 401);

  if (action === "remove") {
    await unshareGames(owner.puuid);
    return json({ shared: 0 });
  }
  if (action === "share") {
    const cleaned = (await Promise.all((body.games as unknown[]).slice(0, MAX_GAMES).map(cleanGame))).filter((g) => g !== null);
    const games = cleaned.filter((g) => isMayhemQueue(g.game.queue));
    if (cleaned.length && !games.length) return json({ error: "Only ARAM: Mayhem games can be shared." }, 400);
    return json({ accepted: games.length, shared: await shareGames(owner.puuid, games) });
  }
  return json({ shared: await sharedCount(owner.puuid) });
}
