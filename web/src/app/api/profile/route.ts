import { NextRequest } from "next/server";
import { json, readBody } from "@/lib/api-body";
import { isPairId, pairStatus, startPair } from "@/lib/riot-pair";
import { cleanProfile, isPlatform, profileByPuuid, profilePath, removeProfile, saveProfile, tokenOwner } from "@/lib/profiles";

// POST /api/profile {action: "publish" | "remove" | "status" | "pair" | "pair-status", token, platform, data?, pair?},
// sent by the My Stats helper on the player's computer. The token decides whose page it is; see lib/profiles.ts.
// "pair" starts a one-click connect the player confirms on their account page, and "pair-status" asks how it went
// (lib/riot-pair.ts).
const MAX_BODY = 32_000;
const ACTIONS = ["publish", "remove", "status", "pair", "pair-status"];

export async function POST(req: NextRequest) {
  const body = await readBody(req, MAX_BODY);
  if (body instanceof Response) return body;
  const { action, token, platform } = body;
  if (typeof token !== "string" || !token || !isPlatform(platform)) return json({ error: "Bad request" }, 400);
  if (typeof action !== "string" || !ACTIONS.includes(action)) return json({ error: "Bad request" }, 400);
  if (action === "pair-status" && !isPairId(body.pair)) return json({ error: "Bad request" }, 400);
  const owner = await tokenOwner(token, platform);
  if (!owner) return json({ error: "Couldn't confirm your account. Make sure the Riot Client is open and signed in." }, 401);

  if (action === "pair") {
    const pair = await startPair(owner, platform);
    return json({ pair, connect: `/account?connect=${pair}#my-stats` });
  }
  if (action === "pair-status") return json(await pairStatus(body.pair as string, owner.puuid));
  if (action === "remove") {
    await removeProfile(owner.puuid);
    return json({ published: false });
  }
  if (action === "publish") {
    const data = cleanProfile(body.data);
    if (!data) return json({ error: "No games to publish" }, 400);
    await saveProfile(owner, platform, data);
    return json({ published: true, path: profilePath(platform, owner.name, owner.tag) });
  }
  const p = await profileByPuuid(owner.puuid);
  return json(p ? { published: true, path: profilePath(p.platform, p.name, p.tag), updated: p.updated } : { published: false });
}
