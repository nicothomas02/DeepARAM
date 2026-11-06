import "server-only";
import { readdirSync } from "node:fs";
import { bySet } from "./sets";
import { fairAugments, type RawAugment } from "./augment-winrate";
import { readRepoCsv, readRepoJson, repoHas, repoPath } from "./repo-data";

// Stat ranges for champion, augment and item pages: the live patch (always the default), the patch
// before, the current set, and every patch we have. Each page type passes the patches it has numbers
// for, so a range that would repeat another one (a set's first patch, say) is left out.

export type RangeKey = "live" | "prev" | "set" | "all";
export type StatRange = { key: RangeKey; label: string; patches: string[] };

const LABEL: Record<RangeKey, string> = { live: "Live patch", prev: "Last patch", set: "This set", all: "All time" };

/** The ranges over these patches (oldest first), live patch first. */
export function statRanges(patches: string[]): StatRange[] {
  if (!patches.length) return [];
  const live = patches[patches.length - 1];
  const candidates: [RangeKey, string[]][] = [
    ["live", [live]],
    ["prev", patches.length > 1 ? [patches[patches.length - 2]] : []],
    ["set", bySet(patches).at(-1)?.patches ?? []],
    ["all", patches],
  ];
  const seen = new Set<string>();
  const out: StatRange[] = [];
  for (const [key, list] of candidates) {
    const id = list.join(",");
    if (!list.length || seen.has(id)) continue;
    seen.add(id);
    out.push({ key, label: LABEL[key], patches: list });
  }
  return out;
}

type PatchWindow = { patch: string; window_start: string; last_day: string; days: number };
const windows = (): PatchWindow[] =>
  (readRepoCsv("data/cn/history/patches.csv") ?? []).map((p) => ({ patch: p.patch, window_start: p.window_start, last_day: p.last_day, days: Number(p.days) || 1 }));

/** The patch whose data window holds this date (YYYY-MM-DD). */
function patchOf(date: string, ws: PatchWindow[]) {
  let found: PatchWindow | undefined;
  for (const w of ws) if (w.window_start <= date) found = w;
  return found;
}

// ---- Augments: one saved table per day; each patch uses its last day. ----

export type AugmentRangeStats = { winRate: number; pickRate: number; winRank: number; pickRank: number; of: number };

type AugRow = RawAugment & { patch: string; days: number };

let augCache: { ranges: StatRange[]; stats: Map<number, Partial<Record<RangeKey, AugmentRangeStats>>> } | null = null;

export function augmentRanges() {
  if (augCache) return augCache;
  const ws = windows();
  const dir = "data/cn/history/augments";
  const files = repoHas(dir) ? readdirSync(repoPath(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.csv$/.test(f)).sort() : [];
  const lastFile = new Map<string, { file: string; w: PatchWindow }>();
  for (const f of files) {
    const w = patchOf(f.slice(0, 10), ws);
    if (w) lastFile.set(w.patch, { file: f, w });
  }
  const order = ws.map((w) => w.patch).filter((p) => lastFile.has(p));
  const rows: AugRow[] = order.flatMap((patch) => {
    const { file, w } = lastFile.get(patch)!;
    const raw = (readRepoCsv(`${dir}/${file}`) ?? []).map((r) => ({
      augment_id: Number(r.augment_id),
      win_rate: Number(r.win_rate),
      pick_rate: Number(r.pick_rate),
      tier: r.tier,
    }));
    return fairAugments(raw).map((r) => ({ ...r, patch, days: w.days }));
  });
  const ranges = statRanges(order);
  const stats = new Map<number, Partial<Record<RangeKey, AugmentRangeStats>>>();
  for (const range of ranges) {
    const inRange = new Set(range.patches);
    const sums = new Map<number, { w: number; wins: number; days: number }>();
    for (const r of rows) {
      if (!inRange.has(r.patch)) continue;
      const s = sums.get(r.augment_id) ?? { w: 0, wins: 0, days: 0 };
      const games = r.pick_rate * r.days;
      s.w += games;
      s.wins += r.win_rate * games;
      s.days += r.days;
      sums.set(r.augment_id, s);
    }
    const list = [...sums].map(([id, s]) => ({ id, winRate: s.w ? s.wins / s.w : 0.5, pickRate: s.days ? s.w / s.days : 0 }));
    const byWin = [...list].sort((a, b) => b.winRate - a.winRate).map((x) => x.id);
    const byPick = [...list].sort((a, b) => b.pickRate - a.pickRate).map((x) => x.id);
    const winRank = new Map(byWin.map((id, i) => [id, i + 1]));
    const pickRank = new Map(byPick.map((id, i) => [id, i + 1]));
    for (const x of list) {
      const m = stats.get(x.id) ?? {};
      m[range.key] = { winRate: x.winRate, pickRate: x.pickRate, winRank: winRank.get(x.id)!, pickRank: pickRank.get(x.id)!, of: list.length };
      stats.set(x.id, m);
    }
  }
  augCache = { ranges, stats };
  return augCache;
}

// ---- Items: each patch's item lists, saved by data/cn/item_history.py. ----

export type ItemEntry = { items: number[]; pick_rate: number; win_rate?: number };
export type ItemLists = { starting?: ItemEntry[]; boots?: ItemEntry[]; other?: ItemEntry[] };
type Snapshot = { patch: string; champions: Record<string, Record<string, [number[], number, number | null][]>> };

/** Each saved patch's item lists per champion id, oldest patch first, with the patch's days. */
export function itemHistory(): { patch: string; days: number; lists: Map<number, ItemLists> }[] {
  const dir = "data/cn/history/items";
  if (!repoHas(dir)) return [];
  const days = new Map(windows().map((w) => [w.patch, w.days]));
  const order = windows().map((w) => w.patch);
  return readdirSync(repoPath(dir))
    .filter((f) => f.endsWith(".json"))
    .map((f) => readRepoJson<Snapshot>(`${dir}/${f}`))
    .filter((s): s is Snapshot => Boolean(s && order.includes(s.patch)))
    .sort((a, b) => order.indexOf(a.patch) - order.indexOf(b.patch))
    .map((s) => ({
      patch: s.patch,
      days: days.get(s.patch) ?? 1,
      lists: new Map(
        Object.entries(s.champions).map(([cid, l]) => [
          Number(cid),
          Object.fromEntries(
            Object.entries(l).map(([k, rows]) => [k, rows.map(([items, pick, win]) => ({ items, pick_rate: pick, ...(win === null ? {} : { win_rate: win }) }))]),
          ) as ItemLists,
        ]),
      ),
    }));
}
