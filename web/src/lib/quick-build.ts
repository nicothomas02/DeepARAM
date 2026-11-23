// The champion page's quick build for every champion, with names and icons resolved: skill order, summoner
// spells, boots, core and situational items, and the top augments as ranked on the page. Feeds /data/watch.json (Apple Watch)
// and /data/overlay.json (the desktop app's in-game overlay).
import { clashWith } from "./item-limits";
import { augmentScores, byScore as augmentOrder } from "@/lib/champion-augments";
import type { AugmentSwap } from "@/lib/build-plan";
import { bestRow, buildOrder, championPage, scoreRows, type ItemRow, type SituationRow } from "@/lib/champion-page";
import { followed } from "@/lib/card-score";
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
  /** The items to buy after the core, one by one with their own numbers, as on the champion page's card
   *  (lib/card-score.ts laterItems). */
  later: LaterItem[];
  /** The same items split by the slot players buy them in (4th, 5th, 6th item), when the buying order is known. */
  laterSlots: { slot: number; items: LaterItem[] }[];
  /** The card's top six-item path: the core plus the best 4th, 5th and 6th picks (lib/card-score.ts fullPicks). */
  full: LaterItem[];
  /** Items to swap in after the core, each with when to buy it ("Vs healing", "With Ethereal Weapon"), as on the
   *  champion page's card, and the build item it replaces when the game won't let you own both (lib/item-limits.ts).
   *  Augment-triggered entries also carry the augment ids and a one-line reason. */
  situational: (Named & { when: string; why?: string; augments?: number[]; replaces?: Named })[];
  /** Components to rush for the first core item. */
  rush: Named[];
  /** "With this augment, buy this item first", as on the champion page's card. */
  swaps: { augment: Named; item: Named }[];
  /** Top augments per rarity, each with its DeepScore on this champion when there's an estimate. */
  augments: Record<Rarity, (Named & { deepScore?: number })[]>;
  /** With two or more build styles (crit and AP Ashe): each style's own card, best DeepScore first; the fields above
   *  are the first one's. Augments per style are estimated (build tags). Same switch as the champion page. */
  builds: (Pick<QuickBuild, "start" | "items" | "rest" | "full" | "later" | "laterSlots" | "situational" | "rush" | "augments"> & { style: string; share: number; deepScore: number })[];
};

/** No raw win or pick rates: the quick build feeds the public app's overlay (tests/unit/overlay-data.test.ts). */
type LaterItem = Named & { deepScore: number | null };

export function quickBuilds(): QuickBuild[] {
  const tiers = new Map(liveTiers().map((t) => [t.id, t]));
  return champList().flatMap(({ id, name }) => {
    const p = championPage(id);
    if (!p) return [];
    const t = tiers.get(id);
    // Same picks as the champion page's card: the best core (with boots when the champion buys them), then the
    // best item for each situation.
    const named = (i: number | undefined) =>
      i !== undefined && p.itemInfo[i] ? { name: p.itemInfo[i].name, icon: p.itemInfo[i].icon ?? null } : null;
    const laterOf = (r: ItemRow) => {
      const n = named(r.items[0]);
      return n ? [{ ...n, deepScore: r.deepScore ?? null }] : [];
    };
    const pieces = (core: ItemRow | undefined, st: ItemRow | null, situ: SituationRow[], rushIds: number[], augSwaps: AugmentSwap[]) => ({
      items: (core ? buildOrder(core) : []).flatMap((i) => named(i) ?? []),
      start: (st?.items ?? []).flatMap((i) => named(i) ?? []),
      rest: (core?.rest ?? []).flatMap((i) => named(i) ?? []),
      full: (core?.full ?? []).flatMap(laterOf),
      later: (core?.later ?? []).flatMap(laterOf),
      laterSlots: (core?.slots ?? []).map((sl) => ({ slot: sl.slot, items: sl.items.flatMap(laterOf) })),
      situational: situ.flatMap((s): QuickBuild["situational"] => {
        const id = s.options[0]?.items[0];
        const n = named(id);
        return n ? [{ ...n, when: SITUATIONS[s.situation] }] : [];
      }).concat(augSwaps.flatMap((sw) => {
        const n = named(sw.item);
        const a = p.augments.find((x) => sw.augments.includes(x.id));
        return n && a ? [{ ...n, when: `With ${a.name}`, why: sw.why, augments: sw.augments }] : [];
      })).map((s) => {
        // An item the game won't let you own with one of the build's items swaps that one out (Mortal Reminder for
        // Lord Dominik's): name it, so the card and the apps replace it instead of adding a seventh item.
        const id = Number(/(\d+)\.png$/.exec(s.icon ?? "")?.[1] ?? NaN);
        const clash = Number.isNaN(id) ? undefined : clashWith(id, [...(core?.items ?? []), ...(core?.rest ?? [])]);
        const replaces = named(clash);
        return replaces ? { ...s, replaces } : s;
      }),
      rush: rushIds.flatMap((i) => named(i) ?? []),
    });
    const rawSpells = fillSpells(id, t?.winRate ?? p.winRate ?? 0.5);
    const spells = (rawSpells.some((r) => r.estimated) ? rawSpells : followed(scoreRows(rawSpells)))[0];

    const swaps = p.swaps.flatMap((sw) => {
      const item = named(sw.item);
      const a = p.augments.find((x) => x.id === sw.augment);
      return item && a ? [{ augment: { name: a.name, icon: `/icons/augments/${a.id}.webp` }, item }] : [];
    });
    // The site's one augment ranking for this champion (lib/champion-augments.ts), as on its page.
    const deep = augmentScores(id);
    const byScore = [...p.augments].sort(augmentOrder(deep));
    const augsOf = (ids?: number[]) => {
      const keep = ids ? byScore.filter((a) => ids.includes(a.id)) : [];
      const list = keep.length >= 3 ? keep : byScore;
      return Object.fromEntries(
      RARITIES.map((r) => [
        r,
        list
          .filter((a) => a.rarity === r)
          .slice(0, 3)
          .map((a) => ({ name: a.name, icon: `/icons/augments/${a.id}.webp`, deepScore: deep.get(a.id) })),
      ]),
    ) as QuickBuild["augments"];
    };
    const builds = p.builds.map((b) => ({
      style: b.style,
      share: Math.round(b.share * 1000) / 1000,
      deepScore: b.deepScore,
      ...pieces(b.core, b.start, b.situational, b.rush, b.augmentSwaps),
      augments: augsOf(b.augments),
    }));
    const first = builds[0] ?? { ...pieces(p.core[0], p.cardStart, p.situational, p.rush, p.augmentSwaps), augments: augsOf() };
    const { start, items, rest, full, later, laterSlots, situational, rush, augments } = first;
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
        full,
        later,
        laterSlots,
        situational,
        rush,
        swaps,
        augments,
        builds,
      },
    ];
  });
}
