import { FIT } from "./deepscore";
import { alongCore, laterItems, leading, MIN_FOLLOWING, scoreRows, sameStyle, situational, skipsBoots, slotItems, fullPicks, type ItemRow, type Rated, type SlotCounts } from "./card-score";
import { buyingOrder, restOfBuild, startFirst, starterFits } from "./build-plan";
import type { ItemTier } from "./items";
import type { Situation } from "./situations";

// The champion page's top card over picked patches (Nico, 2026-11-20: patch, set or all time, several at once).
// Each patch's build numbers are saved per champion (data/cn/history/builds, from 16.20 on; the feed only ever
// serves the newest day). This adds them up, each patch weighted by the champion's games in it, and ranks them the
// way the live card does (lib/champion-page.ts). Runs in the browser: components/champion/Timeframe.tsx.

type Entry = [number[], number, number | null];
export type ItemLists = Partial<Record<"starting" | "boots" | "core" | "other" | "full_builds", Entry[]>>;
export type HistSkill = { max: string[]; pick: number; win: number };
export type HistPatch = { augments: [number, number, string][]; skills: HistSkill[]; items: ItemLists };
export type ItemMeta = { name: string; icon: string; tier: ItemTier; ranked: boolean; situation?: Situation | null; classes?: string[]; parts?: number[] };
export type Rarity = "prismatic" | "gold" | "silver";
/** /data/champion-history/<Alias>: one champion's saved patches, with what the card needs to draw them. */
export type HistFile = {
  patches: Record<string, HistPatch>;
  items: Record<string, ItemMeta>;
  augments: Record<string, { name: string; rarity: Rarity }>;
  /** Core rows in buying order with their pick rates (lib/champion-history.ts orderedCores). */
  order?: [number[], number][];
  /** Core items players buy before the boots (data/estimates/boots_slot.json), when known. */
  bootsAt?: number;
  /** The slot players buy each item in, this champion and all champions (data/estimates/item_slots.json). */
  itemSlots?: { champ: SlotCounts; all: SlotCounts };
};

const GRADE: Record<string, number> = { S: 4, A: 3, B: 2, C: 1 };

type Sum = { w: number; pick: number; wins: number; winW: number };
const add = (m: Map<string, Sum>, key: string, w: number, pick: number, win: number | null) => {
  const s = m.get(key) ?? { w: 0, pick: 0, wins: 0, winW: 0 };
  s.pick += w * pick;
  if (win !== null && Number.isFinite(win)) {
    s.wins += w * pick * win;
    s.winW += w * pick;
  }
  m.set(key, s);
};

/** The picked patches that have saved builds, oldest first. */
export const covered = (file: HistFile, picked: string[]) => picked.filter((p) => file.patches[p]);

export type Card = {
  starting: ItemRow | null;
  augments: { id: number; name: string; rarity: Rarity }[];
  core: ItemRow | null;
  situational: { situation: Situation; options: ItemRow[] }[];
};

/**
 * The card over these patches. `weight`: the champion's games in each patch (pick rate × matches), so a long or
 * busy patch counts for more; `base` and `games` are the champion's win rate and games over the same patches.
 */
export function cardFor(file: HistFile, picked: string[], weight: Record<string, number>, base: number, games?: number): Card | null {
  const list = covered(file, picked);
  if (!list.length) return null;
  const total = list.reduce((s, p) => s + (weight[p] || 0), 0) || list.length;
  const w = (p: string) => (weight[p] || (total === list.length ? 1 : 0)) / total;
  const rated = (s: Sum): Rated => {
    const win = s.winW > 0 ? s.wins / s.winW : base;
    return { winRate: win, pickRate: s.pick, lift: win - base, ...(games ? { games: games * s.pick } : {}) };
  };

  const lists = (name: keyof ItemLists): ItemRow[] => {
    const m = new Map<string, Sum>();
    for (const p of list) for (const [items, pick, win] of file.patches[p].items[name] ?? []) add(m, items.join(","), w(p), pick, win);
    return [...m]
      .map(([k, s]) => ({ items: k.split(",").map(Number), ...rated(s) }))
      .filter((r) => r.items.every((i) => file.items[i]));
  };

  const augs = new Map<number, { pick: number; grade: number; gw: number }>();
  for (const p of list)
    for (const [id, pick, g] of file.patches[p].augments) {
      const a = augs.get(id) ?? { pick: 0, grade: 0, gw: 0 };
      a.pick += w(p) * pick;
      if (GRADE[g]) {
        a.grade += w(p) * pick * GRADE[g];
        a.gw += w(p) * pick;
      }
      augs.set(id, a);
    }
  // Grade first, then pick rate, as on the live card (lib/champion-augment-scores.ts).
  const augments = [...augs]
    .filter(([id]) => file.augments[id])
    .map(([id, a]) => ({ id, grade: a.gw ? a.grade / a.gw : 0, pick: a.pick }))
    .sort((x, y) => Math.round(y.grade * 10) - Math.round(x.grade * 10) || y.pick - x.pick)
    .slice(0, 6)
    .map((a) => ({ id: a.id, ...file.augments[a.id] }));

  // Skill orders don't come from the saved patches: the feed's were one generic list for every champion
  // (champion review, 2026-11-24). The card shows the page's own skill tile (real level-ups), passed to TfCard.

  const boots = scoreRows(lists("boots"), FIT.items, { bound: true });
  const full = lists("full_builds");
  const best = leading(scoreRows(lists("core"), FIT.items, { bound: true }), MIN_FOLLOWING)[0] ?? null;
  let coreRow: ItemRow | null = best;
  // A champion that skips boots gets none on the card (lib/card-score.ts skipsBoots).
  const noBoots = skipsBoots(lists("boots"), full, (i) => file.items[i]?.tier === "boots");
  if (best && !noBoots) {
    // The boots most bought alongside this core in six-item builds, else the best boots.
    const share = new Map<number, number>();
    for (const f of full) {
      if (!best.items.every((i) => f.items.includes(i))) continue;
      for (const i of f.items) if (file.items[i]?.tier === "boots") share.set(i, (share.get(i) ?? 0) + f.pickRate);
    }
    const b = [...share].sort((x, y) => y[1] - x[1])[0]?.[0] ?? boots[0]?.items[0];
    if (b !== undefined) coreRow = file.bootsAt !== undefined ? { ...best, boots: b, bootsAt: file.bootsAt } : { ...best, boots: b };
  }
  // Buying order, starting items that build into the core, and the rest of the build, as on the live card
  // (lib/champion-page.ts).
  const partsOf = (i: number) => file.items[i]?.parts ?? [];
  const standalone = (i: number) => ["starter", "consumable"].includes(file.items[i]?.tier ?? "");
  const starts = scoreRows(lists("starting"), FIT.items, { bound: true }).filter((r) => !r.items.some((i) => file.items[i]?.tier === "legendary"));
  const fitsAll = (c: ItemRow, its: number[]) => (r: ItemRow) => starterFits(r.items, [...its, ...(c.boots !== undefined ? [c.boots] : [])], partsOf, standalone);
  let starting: ItemRow | null = starts[0] ?? null;
  if (coreRow) {
    const c = coreRow;
    const st = starts.find(fitsAll(c, c.items));
    const items = buyingOrder(st ? startFirst(c.items, st.items, partsOf, standalone) : c.items, (file.order ?? []).map(([its, weight]) => ({ items: its, weight }))).items;
    coreRow = { ...c, items, rest: restOfBuild(items, c.boots, full, (i) => file.items[i]?.tier === "boots") };
    starting = starts.find(fitsAll(c, items.slice(0, 1))) ?? st ?? null;
  }
  const core = coreRow;
  const singles = [...lists("other"), ...lists("boots"), ...lists("starting")].filter((r) => r.items.length === 1);
  const taken = new Set(core?.items ?? []);
  const pool = alongCore(
    scoreRows(
      singles.filter((r, i, all) => {
        const id = r.items[0];
        return file.items[id]?.tier === "legendary" && file.items[id].ranked && !taken.has(id) && all.findIndex((x) => x.items[0] === id) === i;
      }),
      FIT.items,
      { bound: true },
    ),
    core?.items ?? [],
    full,
  );

  const classesOf = (i: number) => file.items[i]?.classes ?? [];
  return {
    starting,
    augments,
    core: coreRow
      ? (() => {
          const bySlot = slotItems(pool, coreRow, classesOf, file.itemSlots?.champ, file.itemSlots?.all);
          const later = laterItems(pool, coreRow, classesOf);
          return { ...coreRow, later, ...(bySlot ? { slots: bySlot } : {}), full: fullPicks(coreRow, bySlot ?? undefined, later) };
        })()
      : null,
    situational: core ? situational(sameStyle(pool, core.items, (i) => file.items[i]?.classes ?? []), (i) => file.items[i]?.situation) : [],
  };
}
