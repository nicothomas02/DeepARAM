import { NextRequest } from "next/server";
import { json } from "@/lib/account-route";
import { bearerToken, widgetTokenAccount } from "@/lib/widget-tokens";
import { isPushKind, savePushToken } from "@/lib/widget-live";

// The iPhone app registers where Apple should push the live game (lib/widget-live.ts), with its widget token.
// POST {kind: "start" | "activity", token: hex | null, sandbox: boolean}. "start" starts the Live Activity when a game
// begins; "activity" updates and ends the one that's running.

export async function POST(req: NextRequest) {
  const account = await widgetTokenAccount(bearerToken(req)).catch(() => null);
  if (!account) return json({ error: "Connect the widgets again in the DeepARAM app." }, 401);
  const body = (await req.json().catch(() => null)) as { kind?: unknown; token?: unknown; sandbox?: unknown } | null;
  const token = typeof body?.token === "string" && /^[0-9a-f]{32,400}$/i.test(body.token) ? body.token.toLowerCase() : null;
  if (!isPushKind(body?.kind) || (body?.token !== null && !token)) return json({ error: "Bad request" }, 400);
  try {
    await savePushToken(account, body.kind, token, body.sandbox === true);
    return json({ ok: true });
  } catch {
    return json({ error: "Storage unavailable" }, 503);
  }
}
