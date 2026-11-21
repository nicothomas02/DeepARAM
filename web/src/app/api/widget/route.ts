import { NextRequest } from "next/server";
import { currentAccount } from "@/lib/accounts";
import { json } from "@/lib/account-route";
import { liveTiers } from "@/lib/highlights";
import { patchList } from "@/lib/champions";
import { patchName } from "@/lib/patch-name";
import { readRepoJson } from "@/lib/repo-data";
import { historyGamesSince } from "@/lib/match-history";
import { cleanDevice, createWidgetToken, deleteWidgetToken, widgetTokenAccount } from "@/lib/widget-tokens";
import { widgetSummary, type ChampionTier } from "@/lib/widget-summary";

// The iPhone widgets' data (apps/ios/DeepARAMWidgets, lib/widget-summary.ts). Private: the owner's own week, a tip
// and their champions on the live patch. Nothing here is on a public page.
// POST (signed in as the owner, from the app's sign-in cookie) {device}: a widget token for this device.
// GET with "Authorization: Bearer <token>": the summary.
// DELETE with the same header: forgets the token (Disconnect in the app).

const DAY = 86_400_000;

const bearer = (req: NextRequest) => /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")?.[1] ?? null;

const tiers = (patch: string | null): ChampionTier[] =>
  patch ? liveTiers(patch).map((t) => ({ id: t.id, name: t.name, tier: t.tier, deepScore: Math.round(t.deepScore) })) : [];

type Notes = { patches?: { patch: string; champions?: { name: string; changes: string[] }[] }[] };

export async function POST(req: NextRequest) {
  const a = await currentAccount().catch(() => null);
  if (!a) return json({ error: "Sign in to your DeepARAM account in the app first." }, 401);
  if (!a.owner) return json({ error: "Widgets show the site owner's own games, so they're only for that account for now." }, 403);
  const body = (await req.json().catch(() => ({}))) as { device?: unknown };
  try {
    return json({ token: await createWidgetToken(a.id, cleanDevice(body.device)) });
  } catch {
    return json({ error: "Couldn't connect the widgets right now. Try again later." }, 503);
  }
}

export async function GET(req: NextRequest) {
  const account = await widgetTokenAccount(bearer(req)).catch(() => null);
  if (!account) return json({ error: "Connect the widgets again in the DeepARAM app (More > iPhone widgets)." }, 401);
  const now = Date.now();
  const games = await historyGamesSince(account, now - 120 * DAY).catch(() => []);
  const patches = patchList();
  const live = patches.at(-1) ?? null;
  const name = live ? patchName(live) : null;
  const notes = readRepoJson<Notes>("data/official/patch_notes.json")?.patches?.find((p) => p.patch === name)?.champions ?? [];
  const summary = widgetSummary(games, now, name, tiers(live), tiers(patches.at(-2) ?? null), Object.fromEntries(notes.map((c) => [c.name, c.changes])));
  return json(summary);
}

export async function DELETE(req: NextRequest) {
  const token = bearer(req);
  if (token) await deleteWidgetToken(token).catch(() => undefined);
  return json({ ok: true });
}
