// The desktop app's in-game overlay (apps/desktop): every champion's quick build from the champion page,
// with names and icons, keyed for lookup by the champion's alias. Built once per deploy.
// Only things a player can read before the game: no raw win rates; augments carry their DeepScore on the
// champion (Nico 2026-11-20). Shape is read by apps/desktop/ui/overlay.html.
import { livePatch } from "@/lib/highlights";
import { patchName } from "@/lib/patch-name";
import { quickBuilds } from "@/lib/quick-build";
import { destinyByChampion } from "@/lib/weapon-of-destiny";

export const dynamic = "force-static";

export function GET() {
  const destiny = new Map(destinyByChampion().map((r) => [r.champion, { name: r.item.name, icon: r.item.icon || null }]));
  const champions = quickBuilds().map(({ id, name, skills, spells, start, items, rest, full, later, laterSlots, situational, rush, swaps, augments, builds }) => ({
    id,
    name,
    icon: `/icons/champions/${id}.webp`,
    skills,
    spells,
    start,
    items,
    rest,
    // The card's top six-item path after the core: best 4th, 5th and 6th by DeepScore (site parity).
    full,
    // The usual single items after the core, best first, with their DeepScore (site parity).
    later,
    laterSlots,
    situational,
    rush,
    swaps,
    augments,
    // Build styles (crit and AP Ashe), best DeepScore first; the overlay switches between them.
    builds,
    // The champion's best Weapon of Destiny item (real games): the build engine makes it the first legendary once
    // Weapon of Destiny is taken.
    destiny: destiny.get(id) ?? null,
  }));
  return Response.json({ patch: patchName(livePatch()) || null, champions });
}
