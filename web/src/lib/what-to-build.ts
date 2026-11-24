import "server-only";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import championIds from "@/data/champion-ids.json";
import augmentNames from "@/data/augment-names.json";
import { champList } from "./champions";
import { augmentScores, byScore } from "./champion-augments";
import { items, rewardItems } from "./items";
import { readRepoJson } from "./repo-data";
import { skillOrders } from "./skill-orders";

// "What should I build?" (/what-to-build): for each champion, the build that wins most among builds
// players actually use, the most popular one, boots, skill order and the augments taken most of each
// rarity (data/cn/builds/<id>.json), plus whether the champion builds attack damage, ability power or
// armor, so the page can suggest swaps against a given enemy team.

const IDS = championIds as Record<string, number>;
const NAMES = augmentNames as Record<string, string>;
const GAME_DATA = "plugins/rcp-be-lol-game-data/global/default";

type Row = { items: number[]; pick_rate: number; win_rate?: number };
type Builds = {
  items?: { boots?: Row[]; full_builds?: Row[] };
  augments?: Record<string, { id: number; pick_rate: number; grade?: string }[]>;
};

export type BuildPick = { items: number[]; winRate: number | null; pickRate: number };
export type HelperChamp = {
  id: string;
  name: string;
  kind: "ad" | "ap" | "tank";
  best: BuildPick | null;
  popular: BuildPick | null;
  boots: BuildPick | null;
  skills: string[];
  augs: Record<string, number[]>;
};
export type HelperData = { champions: HelperChamp[]; items: Record<string, [string, string]>; augs: Record<string, string> };

const pick = (r?: Row): BuildPick | null => (r ? { items: r.items, winRate: r.win_rate ?? null, pickRate: r.pick_rate } : null);

let cache: HelperData | null = null;
export function whatToBuildData(): HelperData {
  if (cache) return cache;
  const all = items();
  const rewards = rewardItems();
  const file = join(process.cwd(), "public", "assets", "cd", "latest", GAME_DATA, "v1", "items.json");
  const desc = new Map(
    (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as { id: number; description?: string }[]) : []).map((i) => [i.id, i.description ?? ""]),
  );
  const stat = (id: number, re: RegExp) => re.test(desc.get(id)?.match(/<stats>([\s\S]*?)<\/stats>/i)?.[1] ?? "");
  const used = new Set<number>();
  const champions: HelperChamp[] = [];
  for (const { id, name } of champList()) {
    const b = readRepoJson<Builds>(`data/cn/builds/${IDS[id]}.json`);
    const full = (b?.items?.full_builds ?? []).filter((r) => !r.items.some((i) => rewards.has(i)));
    if (!full.length) continue;
    // Most wins among builds with a real following (at least 2% of games, or the top three by pick).
    const common = full.filter((r, i) => r.pick_rate >= 0.02 || i < 3);
    const best = [...common].sort((x, y) => (y.win_rate ?? 0) - (x.win_rate ?? 0))[0];
    const popular = full[0];
    const counts = { ad: 0, ap: 0, tank: 0 };
    for (const i of popular.items) {
      if (stat(i, /Attack Damage|Critical Strike|Attack Speed/i)) counts.ad++;
      if (stat(i, /Ability Power/i)) counts.ap++;
      if (stat(i, /Armor|Magic Resist/i) && stat(i, /Health/i) && !stat(i, /Ability Power|Attack Damage/i)) counts.tank++;
    }
    const kind = counts.tank >= 3 ? "tank" : counts.ap > counts.ad ? "ap" : "ad";
    const boots = pick(b?.items?.boots?.[0]);
    for (const r of [best, popular, b?.items?.boots?.[0]]) r?.items.forEach((i) => used.add(i));
    const augs: Record<string, number[]> = {};
    // Best of each rarity by the site's one augment ranking (lib/champion-augments.ts), as on the champion page.
    const order = byScore(augmentScores(id));
    for (const r of ["silver", "gold", "prismatic"])
      augs[r] = (b?.augments?.[r] ?? []).filter((a) => NAMES[a.id]).map((a) => ({ id: a.id, pickRate: a.pick_rate, grade: a.grade })).sort(order).slice(0, 3).map((a) => a.id);
    champions.push({ id, name, kind, best: pick(best), popular: best === popular ? null : pick(popular), boots, skills: skillOrders(Number(IDS[id]))?.all[0]?.max ?? [], augs });
  }
  for (const list of Object.values(SWAPS)) for (const ids of Object.values(list)) ids.forEach((i) => used.add(i));
  const itemInfo: HelperData["items"] = {};
  for (const i of used) {
    const it = all.get(i);
    if (it) itemInfo[i] = [it.name, it.icon ?? ""];
  }
  const augs: HelperData["augs"] = {};
  for (const c of champions) for (const ids of Object.values(c.augs)) for (const a of ids) augs[a] = NAMES[a];
  cache = { champions, items: itemInfo, augs };
  return cache;
}

/** Situational items by threat and by what the champion builds, best first. */
export const SWAPS: Record<string, Record<HelperChamp["kind"], number[]>> = {
  healing: { ad: [3033, 3123, 6609], ap: [3165, 3916], tank: [3075] },
  tanky: { ad: [3036, 3071], ap: [3135], tank: [3075, 3071] },
  ap: { ad: [3156, 3091], ap: [3102, 3111], tank: [4401, 3065, 3111] },
  ad: { ad: [6333, 3026, 3047], ap: [3157, 3047], tank: [3143, 3110, 3047] },
  cc: { ad: [3139, 3111], ap: [3111, 3102], tank: [3111] },
};
