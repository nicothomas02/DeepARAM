// quick reference per champion, with names already resolved. Built once per deploy, about 40 KB.
// Shape is decoded by apps/watchos/DeepARAMWatchKit/Sources/DeepARAMWatchKit/WatchData.swift.
import { chefsSpecial, livePatch, liveTiers } from "@/lib/highlights";
import { whatToBuildData } from "@/lib/what-to-build";

export const dynamic = "force-static";

export function GET() {
  const data = whatToBuildData();
  const tiers = new Map(liveTiers().map((t) => [t.id, t]));
  const special = chefsSpecial();
  const champions = data.champions.map((c) => {
    const build = c.best ?? c.popular;
    const items = [...(c.boots?.items ?? []), ...(build?.items ?? [])]
      .filter((id, i, all) => all.indexOf(id) === i && data.items[id])
      .map((id) => data.items[id][0]);
    const augs = (r: string) => (c.augs[r] ?? []).map((a) => data.augs[a]).filter(Boolean);
    const t = tiers.get(c.id);
    return {
      id: c.id,
      name: c.name,
      tier: t?.tier ?? null,
      winRate: t?.winRate ?? null,
      skills: c.skills,
      items,
      augments: { prismatic: augs("prismatic"), gold: augs("gold"), silver: augs("silver") },
    };
  });
  return Response.json({
    patch: livePatch(),
    chefsSpecial: special && {
      title: special.title,
      champion: special.champion,
      name: special.name,
      tier: special.tier || null,
      play: special.play || null,
      items: special.items.map((i) => i.name),
      augments: special.augments.map((a) => ({ name: a.name, rarity: a.rarity })),
    },
    champions,
  });
}
