import { FIT } from "./deepscore";
import { alongCore, bestRow, followed, scoreRows, type ItemRow, type Rated } from "./card-score";
import type { ItemTier } from "./items";

// The champion page's top card over picked patches (Nico, 2026-11-20: patch, set or all time, several at once).
// Each patch's build numbers are saved per champion (data/cn/history/builds, from 16.20 on; the feed only ever
// serves the newest day). This adds them up, each patch weighted by the champion's games in it, and ranks them the
// way the live card does (lib/champion-page.ts). Runs in the browser: components/champion/Timeframe.tsx.

type Entry = [number[], number, number | null];
export type ItemLists = Partial<Record<"starting" | "boots" | "core" | "other" | "full_builds", Entry[]>>;
export type HistSkill = { max: string[]; pick: number; win: number };
export type HistPatch = { augments: [number, number, string][]; skills: HistSkill[]; items: ItemLists };
export type ItemMeta = { name: string; icon: string; tier: ItemTier; ranked: boolean };
export type Rarity = "prismatic" | "gold" | "silver";
/** /data/champion-history/<Alias>: one champion's saved patches, with what the card needs to draw them. */
export type HistFile = {
  patches: Record<string, HistPatch>;
  items: Record<string, ItemMeta>;
  augments: Record<string, { name: string; rarity: Rarity }>;
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
  skill: (Rated & { max: string[] }) | null;
  core: ItemRow | null;
  late: { slot: number; options: ItemRow[] }[];
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

  const sk = new Map<string, Sum>();
  for (const p of list) for (const s of file.patches[p].skills) add(sk, s.max.join(","), w(p), s.pick, s.win);
  const skills = [...sk]
    .map(([k, s]) => ({ max: k.split(","), ...rated(s) }))
    .sort((x, y) => y.pickRate - x.pickRate);

  const boots = scoreRows(lists("boots"), FIT.items);
  const full = lists("full_builds");
  const core = followed(scoreRows(lists("core")))[0] ?? null;
  let coreRow: ItemRow | null = core;
  if (core) {
    // The boots most bought alongside this core in six-item builds, else the best boots; bought last.
    const share = new Map<number, number>();
    for (const f of full) {
      if (!core.items.every((i) => f.items.includes(i))) continue;
      for (const i of f.items) if (file.items[i]?.tier === "boots") share.set(i, (share.get(i) ?? 0) + f.pickRate);
    }
    const b = [...share].sort((x, y) => y[1] - x[1])[0]?.[0] ?? boots[0]?.items[0];
    if (b !== undefined) coreRow = { ...core, boots: b };
  }
  const singles = [...lists("other"), ...lists("boots"), ...lists("starting")].filter((r) => r.items.length === 1);
  const taken = new Set(core?.items ?? []);
  const pool = alongCore(
    scoreRows(
      singles.filter((r, i, all) => {
        const id = r.items[0];
        return file.items[id]?.tier === "legendary" && file.items[id].ranked && !taken.has(id) && all.findIndex((x) => x.items[0] === id) === i;
      }),
    ),
    core?.items ?? [],
    full,
  );
  const late: Card["late"] = [];
  if (core)
    for (const slot of [4, 5, 6]) {
      const options = pool.filter((r) => !taken.has(r.items[0])).slice(0, 3);
      if (!options.length) break;
      late.push({ slot, options });
      taken.add(options[0].items[0]);
    }

  return {
    starting: scoreRows(lists("starting"), FIT.items)[0] ?? null,
    augments,
    skill: bestRow(skills, 0.1),
    core: coreRow,
    late,
  };
}
