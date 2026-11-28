import { championPage, type ItemRow } from "./champion-page";
import { champList } from "./champions";
import { ITEM_TIERS, type ItemTier } from "./items";
import { ITEM_CHANGERS } from "./augment-swaps";
import { patchName } from "./patch-name";
import augmentNames from "@/data/augment-names.json";
import { buildLabel } from "./build-labels";
import type { Situation } from "./situations";

// The champion page's two longest lists, loaded only when a visitor opens them (Nico's "trim the worst", 2026-11-25):
// the teammates past the first MATES_FIRST rows and the whole "All items" fold. Together they were about half the
// page's elements. The page renders the first rows itself; /data/champion-lists/<Alias> serves the rest, built once
// per deploy (app/data/champion-lists/[alias]/route.ts).

const AUG_NAMES = augmentNames as Record<string, string>;

/** Teammate rows the page renders itself; the rest load on "Show all". */
export const MATES_FIRST = 8;

export type LazyMate = { id: string; name: string; synergy: number; pickRate: number; noCC: boolean; games: number | null };
export type LazyTile = {
  id: number;
  deepScore?: number;
  deepEdge?: number;
  lift: number;
  winRate: number;
  games?: number;
  pickRate: number;
  /** Few players build it though it scores above the card's best full-build pick; the augment that explains it. */
  few?: { augment?: string; build?: string; situation?: Situation };
};
export type LazyOlder = { id: number; winRate: number; games?: number; pickRate: number };
export type LazyTier = { tier: ItemTier; rows: LazyTile[]; older: LazyOlder[] };
export type ChampionLists = {
  mates: LazyMate[];
  items: LazyTier[];
  earlierPatch: string;
  info: Record<number, { name: string; icon?: string }>;
};

const tierOf = (r: ItemRow) => r.tier ?? "legendary";

export function championLists(alias: string): ChampionLists | null {
  const p = championPage(alias);
  if (!p) return null;
  const names = new Map(champList().map((c) => [c.id, c.name]));
  const mates = p.mates.slice(MATES_FIRST).map((m) => ({ ...m, name: names.get(m.id) ?? m.id }));

  // Legendaries that score above the card's best full-build pick but that few players build (under a quarter of the
  // most built one): say why they aren't in the build (Nico 2026-11-23). The bar was the weakest full-build pick until
  // 2026-11-25: backtested 16.22 -> 16.23, items over the weakest held up 55% of the time, over the best 88%
  // (research/few-players-items), so Nico chose the best.
  const legend = p.items.filter((r) => tierOf(r) === "legendary");
  const topPick = Math.max(0, ...legend.map((r) => r.pickRate));
  const fullScores = (p.core[0]?.full ?? []).map((r) => r.deepScore ?? 0);
  const fullBar = fullScores.length ? Math.max(...fullScores) : Infinity;
  // What else on the page explains a tagged item (2026-11-25, case by case): another build tab it belongs to, or the
  // card's situational list. An augment that explains it comes first, then the build, then the situation.
  const buildOf = new Map<number, string>();
  for (const b of p.builds)
    if (!b.main) for (const i of [...b.core.items, ...(b.core.full ?? []).map((r) => r.items[0])]) if (!buildOf.has(i)) buildOf.set(i, buildLabel(b.style, b.niche));
  const situationOf = new Map<number, Situation>();
  for (const s of p.situational) for (const o of s.options) if (!situationOf.has(o.items[0])) situationOf.set(o.items[0], s.situation);
  const items: LazyTier[] = [];
  const used = new Set<number>();
  for (const tier of ITEM_TIERS) {
    const list = p.items.filter((r) => tierOf(r) === tier);
    const older = p.earlierItems.filter((r) => tierOf(r) === tier);
    if (!list.length && !older.length) continue;
    items.push({
      tier,
      rows: list.map((r) => {
        const id = r.items[0];
        used.add(id);
        const few = tier === "legendary" && r.pickRate < 0.25 * topPick && (r.deepScore ?? 0) > fullBar;
        const c = few ? ITEM_CHANGERS.find((x) => x.item === id && p.augments.some((a) => x.ids.includes(a.id))) : undefined;
        const aug = c && p.augments.find((a) => c.ids.includes(a.id))?.id;
        return {
          id,
          deepScore: r.deepScore,
          deepEdge: r.deepEdge,
          lift: r.lift,
          winRate: r.winRate,
          games: r.games,
          pickRate: r.pickRate,
          few: few
            ? aug
              ? { augment: AUG_NAMES[aug] }
              : buildOf.has(id)
                ? { build: buildOf.get(id) }
                : situationOf.has(id)
                  ? { situation: situationOf.get(id) }
                  : {}
            : undefined,
        };
      }),
      older: older.map((r) => {
        used.add(r.items[0]);
        return { id: r.items[0], winRate: r.winRate, games: r.games, pickRate: r.pickRate };
      }),
    });
  }
  const info = Object.fromEntries([...used].filter((id) => p.itemInfo[id]).map((id) => [id, p.itemInfo[id]]));
  return { mates, items, earlierPatch: p.earlierPatch ? patchName(p.earlierPatch) : "", info };
}
