// The Apple Watch app's data: live patch, today's Chef Special and the champion page's quick build for
// every champion (skill order, summoner spells, boots, core and late items, top augments by DeepScore),
// with names already resolved. Built once per deploy.
// Shape is decoded by apps/watchos/DeepARAMWatchKit/Sources/DeepARAMWatchKit/WatchData.swift.
import { augmentTiers } from "@/lib/augment-tiers";
import { bestRow, championPage, scoreRows } from "@/lib/champion-page";
import { champList } from "@/lib/champions";
import { fillSpells } from "@/lib/fill";
import { chefsSpecial, livePatch, liveTiers } from "@/lib/highlights";
import { patchName } from "@/lib/patch-name";

export const dynamic = "force-static";

const RARITIES = ["prismatic", "gold", "silver"] as const;

export function GET() {
  const tiers = new Map(liveTiers().map((t) => [t.id, t]));
  const scores = new Map(augmentTiers().map((a) => [a.id, a.deepScore]));
  const special = chefsSpecial();
  const champions = champList().flatMap(({ id, name }) => {
    const p = championPage(id);
    if (!p) return [];
    const t = tiers.get(id);
    // Same picks as the champion page's "Best" column: boots, the best core, then the top pick for the
    // 4th, 5th and 6th slot.
    const core = p.core[0];
    const itemIds = core ? [...(core.boots ? [core.boots] : []), ...core.items, ...p.late.map((s) => s.options[0]?.items[0])] : [];
    const items = [...new Set(itemIds.map((i) => (i ? p.itemInfo[i]?.name : undefined)).filter((n): n is string => !!n))];
    const rawSpells = fillSpells(id, t?.winRate ?? p.winRate ?? 0.5);
    const spells = (rawSpells.some((r) => r.estimated) ? rawSpells : scoreRows(rawSpells))[0];
    const byScore = [...p.augments].sort(
      (x, y) => (scores.get(y.id) ?? -1) - (scores.get(x.id) ?? -1) || y.pickRate - x.pickRate,
    );
    const augments = Object.fromEntries(
      RARITIES.map((r) => [r, byScore.filter((a) => a.rarity === r).slice(0, 3).map((a) => a.name)]),
    );
    return [
      {
        id,
        name,
        tier: t?.tier ?? null,
        winRate: t?.winRate ?? null,
        deepScore: t?.deepScore ?? null,
        skills: bestRow(p.skills, 0.1)?.max ?? [],
        spells: spells?.spells.map((s) => s.name) ?? [],
        items,
        augments,
      },
    ];
  });
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
