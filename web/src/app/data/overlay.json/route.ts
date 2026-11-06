// The desktop app's in-game overlay (apps/desktop): every champion's quick build from the champion page,
// with names and icons, keyed for lookup by the champion's alias. Built once per deploy.
// Only things a player can read before the game: no win rates (Riot's policy bans augment win rates in
// overlays), no tiers. Shape is read by apps/desktop/ui/overlay.html.
import { livePatch } from "@/lib/highlights";
import { patchName } from "@/lib/patch-name";
import { quickBuilds } from "@/lib/quick-build";

export const dynamic = "force-static";

export function GET() {
  const champions = quickBuilds().map(({ id, name, skills, spells, items, augments }) => ({
    id,
    name,
    icon: `/icons/champions/${id}.webp`,
    skills,
    spells,
    items,
    augments,
  }));
  return Response.json({ patch: patchName(livePatch()) || null, champions });
}
