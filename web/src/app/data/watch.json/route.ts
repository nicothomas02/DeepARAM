// The Apple Watch app's data: live patch, today's Chef Special and the champion page's quick build for
// every champion (skill order, summoner spells, boots, core and late items, top augments by DeepScore),
// with names already resolved. Built once per deploy.
// Shape is decoded by apps/watchos/DeepARAMWatchKit/Sources/DeepARAMWatchKit/WatchData.swift.
import { chefsSpecial, livePatch } from "@/lib/highlights";
import { patchName } from "@/lib/patch-name";
import { quickBuilds, RARITIES, type Named } from "@/lib/quick-build";

export const dynamic = "force-static";

const names = (list: Named[]) => list.map((x) => x.name);

export function GET() {
  const special = chefsSpecial();
  const champions = quickBuilds().map((c) => ({
    ...c,
    spells: names(c.spells),
    items: names(c.items),
    augments: Object.fromEntries(RARITIES.map((r) => [r, names(c.augments[r])])),
  }));
  return Response.json({
    patch: patchName(livePatch()) || null,
    chefsSpecial: special && {
      title: special.title,
      date: special.date,
      champion: special.champion,
      name: special.name,
      tier: special.tier || null,
      why: special.why || null,
      play: special.play || null,
      items: special.items.map((i) => i.name),
      augments: special.augments.map((a) => ({ name: a.name, rarity: a.rarity })),
    },
    champions,
  });
}
