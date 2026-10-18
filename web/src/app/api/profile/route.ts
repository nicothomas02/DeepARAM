import { NextRequest } from "next/server";
import { AccountError, linkRiot } from "@/lib/accounts";
import { isPairId, pairStatus, startPair } from "@/lib/riot-pair";
import { cleanProfile, isPlatform, profileByPuuid, profilePath, removeProfile, saveProfile, tokenOwner } from "@/lib/profiles";

// POST /api/profile {action: "publish" | "remove" | "status" | "link" | "pair" | "pair-status", token, platform,
// data?, code?, pair?}, sent by the My Stats helper on the player's computer. The token decides whose page it is;
// see lib/profiles.ts. "link" connects that Riot account to the site account that showed `code` (lib/accounts.ts);
// "pair" starts a one-click connect the player confirms on their account page, and "pair-status" asks how it went
// (lib/riot-pair.ts).
const MAX_BODY = 32_000;

const json = (obj: unknown, status = 200) => Response.json(obj, { status, headers: { "Cache-Control": "no-store" } });

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

  if (action === "link") {
    try {
      await linkRiot(body.code, owner, platform);
    } catch (err) {
      if (err instanceof AccountError) return json({ error: err.message }, err.status);
      throw err;
    }
    return json({ linked: true, riotId: `${owner.name}#${owner.tag}` });
  }
  if (action === "pair") {
    const pair = await startPair(owner, platform);
    return json({ pair, connect: `/account?connect=${pair}#my-stats` });
  }
  if (action === "pair-status") {
    if (!isPairId(body.pair)) return json({ error: "Bad request" }, 400);
    return json(await pairStatus(body.pair, owner.puuid));
  }
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
