import { NextRequest } from "next/server";
import { currentAccount } from "@/lib/accounts";
import { isPlatform, tokenOwner } from "@/lib/profiles";
import { cleanHistoryGame, historyCount, historyGames, ME, ownerAccountFor, removeHistory, saveHistory } from "@/lib/match-history";

// The site owner's own games, kept with their account (lib/match-history.ts).
// POST {action: "save" | "remove" | "status", token, platform, games?}: sent by the My Stats helper. The token
//   proves which Riot account it is; only the owner account's connected Riot account can save games.
// GET: the signed-in account's saved games, for the dashboard on /account. Nobody else's.
const MAX_BODY = 1_500_000;
const MAX_GAMES = 100;

const json = (obj: unknown, status = 200) => Response.json(obj, { status, headers: { "Cache-Control": "no-store" } });

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
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: "Too large" }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const { action, token, platform } = body ?? {};
  if (typeof token !== "string" || !isPlatform(platform)) return json({ error: "Bad request" }, 400);
  const owner = await tokenOwner(token, platform);
  if (!owner) return json({ error: "Couldn't confirm your account. Make sure the Riot Client is open and signed in." }, 401);
  const account = await ownerAccountFor(owner.puuid);
  if (action === "status") return json(account ? { available: true, saved: await historyCount(account) } : { available: false });
  if (!account) return json({ error: "Saving games to your account isn't available for this account." }, 403);
  if (action === "remove") {
    await removeHistory(account);
    return json({ saved: 0 });
  }
  if (action === "save") {
    const games = (Array.isArray(body.games) ? body.games.slice(0, MAX_GAMES) : []).map(cleanHistoryGame).filter((g) => g !== null);
    return json({ accepted: games.length, saved: await saveHistory(account, games) });
  }
  return json({ error: "Bad request" }, 400);
}
