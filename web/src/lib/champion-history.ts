import "server-only";
import { readdirSync } from "node:fs";
import championIds from "@/data/champion-ids.json";
import augmentNames from "@/data/augment-names.json";
import { itemTier, items, ranked, rewardItems } from "./items";
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
  const out: HistFile = { patches: {}, items: {}, augments: {} };
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
            out.items[i] = { name: it.name, icon: it.icon ?? "", tier: itemTier(i), ranked: ranked(i) } satisfies ItemMeta;
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
