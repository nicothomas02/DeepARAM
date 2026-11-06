// The champion page's quick build for every champion, with names and icons resolved: skill order, summoner
// spells, boots, core and late items, and the top augments by DeepScore. Feeds /data/watch.json (Apple Watch)
// and /data/overlay.json (the desktop app's in-game overlay).
import { augmentTiers } from "@/lib/augment-tiers";
import { bestRow, buildOrder, championPage, scoreRows } from "@/lib/champion-page";
import { champList } from "@/lib/champions";
import { fillSpells } from "@/lib/fill";
import { liveTiers } from "@/lib/highlights";

export const RARITIES = ["prismatic", "gold", "silver"] as const;
export type Rarity = (typeof RARITIES)[number];
export type Named = { name: string; icon: string | null };

export type QuickBuild = {
  id: string;
  name: string;
  tier: string | null;
  winRate: number | null;
  deepScore: number | null;
  skills: string[];
  spells: Named[];
  items: Named[];
  augments: Record<Rarity, Named[]>;
};

export function quickBuilds(): QuickBuild[] {
  const tiers = new Map(liveTiers().map((t) => [t.id, t]));
  const scores = new Map(augmentTiers().map((a) => [a.id, a.deepScore]));
  return champList().flatMap(({ id, name }) => {
    const p = championPage(id);
    if (!p) return [];
    const t = tiers.get(id);
    // Same picks as the champion page's "Best" column: boots, the best core, then the top pick for the
    // 4th, 5th and 6th slot.
    const core = p.core[0];
    const itemIds = core ? [...buildOrder(core), ...p.late.map((s) => s.options[0]?.items[0])] : [];
    const items = [...new Set(itemIds)].flatMap((i) =>
      i !== undefined && p.itemInfo[i] ? [{ name: p.itemInfo[i].name, icon: p.itemInfo[i].icon ?? null }] : [],
    );
    const rawSpells = fillSpells(id, t?.winRate ?? p.winRate ?? 0.5);
    const spells = (rawSpells.some((r) => r.estimated) ? rawSpells : scoreRows(rawSpells))[0];
    const byScore = [...p.augments].sort(
      (x, y) => (scores.get(y.id) ?? -1) - (scores.get(x.id) ?? -1) || y.pickRate - x.pickRate,
    );
    const augments = Object.fromEntries(
      RARITIES.map((r) => [
        r,
        byScore
          .filter((a) => a.rarity === r)
          .slice(0, 3)
          .map((a) => ({ name: a.name, icon: `/icons/augments/${a.id}.webp` })),
      ]),
    ) as Record<Rarity, Named[]>;
    return [
      {
        id,
        name,
        tier: t?.tier ?? null,
        winRate: t?.winRate ?? null,
        deepScore: t?.deepScore ?? null,
        skills: bestRow(p.skills, 0.1)?.max ?? [],
        spells: spells?.spells.map((s) => ({ name: s.name, icon: s.icon ?? null })) ?? [],
        items,
        augments,
      },
    ];
  });
}
