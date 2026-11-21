import { NextRequest } from "next/server";
import { json } from "@/lib/account-route";
import { isPlatform, tokenOwner } from "@/lib/profiles";
import { ownerAccountFor } from "@/lib/match-history";
import { cleanLive, pushTokens, saveLive } from "@/lib/widget-live";

// The owner's PC app reports the live Mayhem game for the iPhone (lib/widget-live.ts).
// POST {token, platform, live}: token is the Riot Client's, as the My Stats helper sends to /api/history, and only the
// owner's connected Riot account is accepted. live is the game (or null when it ended). The answer carries the phone's
// push tokens, so the PC app can push the update to the Live Activity itself.

const MAX_BODY = 8_000;

// Checking a Riot token is a call to Riot; a game posts every few seconds, so a checked token is trusted for 10 minutes.
const checked = new Map<string, { account: string; until: number }>();

async function ownerFor(token: string, platform: unknown): Promise<string | null> {
  const hit = checked.get(token);
  if (hit && hit.until > Date.now()) return hit.account;
  if (!isPlatform(platform)) return null;
  const owner = await tokenOwner(token, platform);
  const account = owner ? await ownerAccountFor(owner.puuid) : null;
  if (account) {
    if (checked.size > 50) checked.clear();
    checked.set(token, { account, until: Date.now() + 600_000 });
  }
  return account;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ error: "Too large" }, 413);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  if (typeof body?.token !== "string") return json({ error: "Bad request" }, 400);
  const account = await ownerFor(body.token, body.platform).catch(() => null);
  if (!account) return json({ error: "Only the site owner's Riot account can send a live game." }, 403);
  const live = body.live === null ? null : cleanLive(body.live);
  if (body.live !== null && !live) return json({ error: "Bad live game" }, 400);
  try {
    await saveLive(account, live);
    return json({ ok: true, push: await pushTokens(account) });
  } catch {
    return json({ error: "Storage unavailable" }, 503);
  }
}
