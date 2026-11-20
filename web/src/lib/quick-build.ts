// The champion page's quick build for every champion, with names and icons resolved: skill order, summoner
// spells, boots, core and situational items, and the top augments as ranked on the page. Feeds /data/watch.json (Apple Watch)
// and /data/overlay.json (the desktop app's in-game overlay).
import { augmentScores, byScore as augmentOrder } from "@/lib/champion-augments";
import { bestRow, buildOrder, championPage, scoreRows } from "@/lib/champion-page";
import { champList } from "@/lib/champions";
import { fillSpells } from "@/lib/fill";
import { liveTiers } from "@/lib/highlights";
import { SITUATIONS } from "@/lib/situations";

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
  /** Starting items that build into the core (none when no common start does). */
  start: Named[];
  /** Boots (when the champion buys them) and the best core, in buying order. */
  items: Named[];
  /** The rest of the usual six-item build after the core, most built first. */
  rest: Named[];
  /** Items to swap in after the core, each with when to buy it ("Vs healing"), as on the champion page's card. */
  situational: (Named & { when: string })[];
  /** Components to rush for the first core item. */
  rush: Named[];
  /** "With this augment, buy this item first", as on the champion page's card. */
  swaps: { augment: Named; item: Named }[];
  augments: Record<Rarity, Named[]>;
};

export function quickBuilds(): QuickBuild[] {
  const tiers = new Map(liveTiers().map((t) => [t.id, t]));
  return champList().flatMap(({ id, name }) => {
    const p = championPage(id);
    if (!p) return [];
    const t = tiers.get(id);
    // Same picks as the champion page's card: the best core (with boots when the champion buys them), then the
    // best item for each situation.
    const core = p.core[0];
    const named = (i: number | undefined) =>
      i !== undefined && p.itemInfo[i] ? { name: p.itemInfo[i].name, icon: p.itemInfo[i].icon ?? null } : null;
    const items = (core ? buildOrder(core) : []).flatMap((i) => named(i) ?? []);
    const start = (p.cardStart?.items ?? []).flatMap((i) => named(i) ?? []);
    const rest = (core?.rest ?? []).flatMap((i) => named(i) ?? []);
    const situational = p.situational.flatMap((s) => {
      const n = named(s.options[0]?.items[0]);
      return n ? [{ ...n, when: SITUATIONS[s.situation] }] : [];
    });
    const rawSpells = fillSpells(id, t?.winRate ?? p.winRate ?? 0.5);
    const spells = (rawSpells.some((r) => r.estimated) ? rawSpells : scoreRows(rawSpells))[0];
    const rush = p.rush.flatMap((i) => named(i) ?? []);
    const swaps = p.swaps.flatMap((sw) => {
      const item = named(sw.item);
      const a = p.augments.find((x) => x.id === sw.augment);
      return item && a ? [{ augment: { name: a.name, icon: `/icons/augments/${a.id}.webp` }, item }] : [];
    });
    // The site's one augment ranking for this champion (lib/champion-augments.ts), as on its page.
    const byScore = [...p.augments].sort(augmentOrder(augmentScores(id)));
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
        start,
        items,
        rest,
        situational,
        rush,
        swaps,
        augments,
      },
    ];
  });
}
