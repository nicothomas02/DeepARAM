import "server-only";
import { readdirSync } from "node:fs";
import championIds from "@/data/champion-ids.json";
import augmentNames from "@/data/augment-names.json";
import { itemClasses, itemParts, itemSituation, itemTier, items, ranked, rewardItems } from "./items";
import { readRepoJson, repoHas, repoPath } from "./repo-data";
import type { HistFile, HistPatch, ItemMeta, Rarity } from "./timeframe";

// Each champion's saved build numbers per patch (data/cn/builds_history.py), for the top card's timeframe picker.
// Served at /data/champion-history/<Alias>; the page itself only carries the live numbers.

const IDS = championIds as Record<string, number>;
const AUGS = augmentNames as Record<string, string>;
const DIR = "data/cn/history/builds";

type Snapshot = {
  patch: string;
  champions: Record<
    string,
    {
      augments: [number, number, string][];
      skills: { max_order: string[]; pick_rate: number; win_rate: number }[];
      items: HistPatch["items"];
    }
  >;
};

let snaps: Snapshot[] | null = null;
const snapshots = () =>
  (snaps ??= repoHas(DIR)
    ? readdirSync(repoPath(DIR))
        .filter((f) => f.endsWith(".json"))
        .map((f) => readRepoJson<Snapshot>(`${DIR}/${f}`))
        .filter((s): s is Snapshot => Boolean(s))
    : []);

/** The patches with saved builds. */
export const historyPatches = () => snapshots().map((s) => s.patch);

let rarities: Map<number, Rarity> | null = null;
/** Each augment's rarity, from the champions' live augment lists (it doesn't change between champions). */
function rarityOf(id: number): Rarity {
  if (!rarities) {
    rarities = new Map();
    for (const cid of Object.values(IDS)) {
      const b = readRepoJson<{ augments?: Partial<Record<Rarity, { id: number }[]>> }>(`data/cn/builds/${cid}.json`);
      for (const r of ["prismatic", "gold", "silver"] as const) for (const a of b?.augments?.[r] ?? []) rarities.set(a.id, r);
    }
  }
  return rarities.get(id) ?? "silver";
}

export function championHistory(alias: string): HistFile | null {
  const id = IDS[alias];
  if (id === undefined) return null;
  const all = items();
  const rewards = rewardItems();
  const slots = readRepoJson<{ champions: Record<string, [number | null, number]>; all: number }>("data/estimates/boots_slot.json");
  const bootsAt = slots ? (slots.champions[String(id)]?.[0] ?? slots.all) : undefined;
  const out: HistFile = { patches: {}, items: {}, augments: {}, order: orderedCores(id).map((r) => [r.items, r.weight]), ...(bootsAt !== undefined ? { bootsAt } : {}) };
  for (const s of snapshots()) {
    const c = s.champions[String(id)];
    if (!c) continue;
    const lists: HistPatch["items"] = {};
    for (const [k, rows] of Object.entries(c.items)) {
      const kept = (rows ?? []).filter(([ids]) => ids.every((i) => all.has(i) && !rewards.has(i)));
      lists[k as keyof HistPatch["items"]] = kept;
      for (const [ids] of kept)
        for (const i of ids)
          if (!out.items[i]) {
            const it = all.get(i)!;
            out.items[i] = { name: it.name, icon: it.icon ?? "", tier: itemTier(i), ranked: ranked(i), situation: itemSituation(i), classes: itemClasses(i), parts: itemParts(i) } satisfies ItemMeta;
          }
    }
    const augs = c.augments.filter(([a]) => AUGS[a]);
    for (const [a] of augs) out.augments[a] ??= { name: AUGS[a], rarity: rarityOf(a) };
    out.patches[s.patch] = {
      augments: augs,
      skills: c.skills.map((k) => ({ max: k.max_order, pick: k.pick_rate, win: k.win_rate })),
      items: lists,
    };
  }
  return out;
}

/** Core rows listed in buying order from the patches whose core block still came from the feed (it froze in
 *  mid-October 2026 and is rebuilt from six-item builds since, which carry no order). A patch counts as ordered when
 *  most champions have the same three items in two orders, which a rebuilt block almost never has. */
export function orderedCores(id: number): { items: number[]; weight: number; win: number | null }[] {
  const out: { items: number[]; weight: number; win: number | null }[] = [];
  for (const s of snapshots().filter(isOrdered))
    for (const [ids, pick, win] of s.champions[String(id)]?.items.core ?? []) out.push({ items: ids, weight: pick ?? 0, win: win ?? null });
  return out;
}

const ordered = new Map<string, boolean>();
function isOrdered(s: Snapshot): boolean {
  let v = ordered.get(s.patch);
  if (v === undefined) {
    const champs = Object.values(s.champions);
    v = champs.filter((c) => {
      const sets = (c.items.core ?? []).map(([ids]) => [...ids].sort((x, y) => x - y).join(","));
      return new Set(sets).size < sets.length;
    }).length > champs.length / 2;
    ordered.set(s.patch, v);
  }
  return v;
}
