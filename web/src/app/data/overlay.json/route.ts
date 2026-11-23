// The desktop app's in-game overlay (apps/desktop): every champion's quick build from the champion page,
// with names and icons, keyed for lookup by the champion's alias. Built once per deploy.
// Only things a player can read before the game: no raw win rates; augments carry their DeepScore on the
// champion (Nico 2026-11-20). Shape is read by apps/desktop/ui/overlay.html.
import { livePatch } from "@/lib/highlights";
import { patchName } from "@/lib/patch-name";
import { quickBuilds } from "@/lib/quick-build";

export const dynamic = "force-static";

export function GET() {
  const champions = quickBuilds().map(({ id, name, skills, spells, start, items, rest, later, laterSlots, situational, rush, swaps, augments, builds }) => ({
    id,
    name,
    icon: `/icons/champions/${id}.webp`,
    skills,
    spells,
    start,
    items,
    rest,
    // The usual single items after the core, best first, with their DeepScore (site parity).
    later,
    laterSlots,
    situational,
    rush,
    swaps,
    augments,
    // Build styles (crit and AP Ashe), best DeepScore first; the overlay switches between them.
    builds,
  }));
  return Response.json({ patch: patchName(livePatch()) || null, champions });
}
