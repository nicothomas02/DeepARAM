import { NextRequest } from "next/server";
import { currentAccount } from "@/lib/accounts";
import { json, readBody } from "@/lib/api-body";
import { isMayhemQueue } from "@/lib/mayhem-queues";
import { isPlatform, tokenOwner } from "@/lib/profiles";
import { cleanHistoryGame, historyCount, historyGames, ME, ownerAccountFor, removeHistory, saveHistory } from "@/lib/match-history";

// The site owner's own games, kept with their account (lib/match-history.ts).
// POST {action: "save" | "remove" | "status", token, platform, games?}: sent by the My Stats helper. The token
//   proves which Riot account it is; only the owner account's connected Riot account can save games. Only
//   Mayhem games are kept (lib/mayhem-queues.ts): the importer filters the same way, so anything else is a bad request.
// GET: the signed-in account's saved games, for the dashboard on /account. Nobody else's.
//   Follow-up: historyGames() returns every saved game in one answer; a limit/offset belongs in lib/match-history.ts
//   once the dashboard can ask for pages.
const MAX_BODY = 1_500_000;
const MAX_GAMES = 100;

export async function GET() {
  const a = await currentAccount().catch(() => null);
  if (!a) return json({ error: "Sign in first." }, 401);
  try {
    return json({ puuid: ME, games: await historyGames(a.id) });
  } catch {
    return json({ puuid: ME, games: [] });
  }
}

export async function POST(req: NextRequest) {
  const body = await readBody(req, MAX_BODY);
  if (body instanceof Response) return body;
  const { action, token, platform } = body;
  if (typeof token !== "string" || !token || !isPlatform(platform)) return json({ error: "Bad request" }, 400);
  if (action !== "save" && action !== "remove" && action !== "status") return json({ error: "Bad request" }, 400);
  if (action === "save" && !Array.isArray(body.games)) return json({ error: "Bad request" }, 400);
  const owner = await tokenOwner(token, platform);
  if (!owner) return json({ error: "Couldn't confirm your account. Make sure the Riot Client is open and signed in." }, 401);
  const account = await ownerAccountFor(owner.puuid);
  if (action === "status") return json(account ? { available: true, saved: await historyCount(account) } : { available: false });
  if (!account) return json({ error: "Saving games to your account isn't available for this account." }, 403);
  if (action === "remove") {
    await removeHistory(account);
    return json({ saved: 0 });
  }
  const cleaned = (body.games as unknown[]).slice(0, MAX_GAMES).map(cleanHistoryGame).filter((g) => g !== null);
  const games = cleaned.filter((g) => isMayhemQueue(g.queueId));
  if (cleaned.length && !games.length) return json({ error: "Only ARAM: Mayhem games can be saved." }, 400);
  return json({ accepted: games.length, saved: await saveHistory(account, games) });
}
