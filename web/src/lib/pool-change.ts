import "server-only";
import championIds from "@/data/champion-ids.json";
import championNames from "@/data/champion-names.json";
import { readRepoJson } from "./repo-data";

// Champions whose augment pool changed between two patches: at least POOL_CHANGE_SHARE of their augment picks on the
// earlier patch went to augments that are gone from the later one (Yunara and Critical Missile, 16.21). Their
// "{live}+" numbers keep the live patch alone (lib/tiers.ts plusRows): research/pool-change/pool_change.py,
// 2026-11-27, 166 champion-patch pairs lost 5%+ of their picks; pooling them erred 1.17 pt at 3,000 live games vs
// 0.72 pt for the live patch alone (0.76 vs 0.39 at 10,000). Below about 1,000 live games pooling still helped.
export const POOL_CHANGE_SHARE = 0.05;

type Table = Record<string, Record<string, [number, number]>>;
const ALIAS = Object.fromEntries(Object.entries(championIds as Record<string, number>).map(([a, id]) => [String(id), a]));
const load = (patch: string) => readRepoJson<Table>(`data/aramhex/patches/${patch}/augments.json`);

// Champions the live patch's ARAM: Mayhem notes changed (damage dealt/taken and Mayhem-only kit changes) keep the live
// patch alone too (Nico chose 2026-11-27, research/decay): their win rate moved 3.4 pts between patches vs 1.0 for
// the rest, and the reset halved their day-1 error (1,000 live games: 2.37 -> 1.22 pts; 10,000: 0.56 -> 0.40).
// Changes in the main (Summoner's Rift) champion notes moved Mayhem win rates no more than untouched champions, so
// they don't count. data/official/patch_notes.json is matched by display name.
type Notes = { patches?: { gameVersion: string; champions?: { name: string }[] }[] };
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const BY_NAME = new Map(Object.entries(championNames as Record<string, string>).map(([alias, name]) => [norm(name), alias]));

export function mayhemChanged(live: string): string[] {
  const entry = readRepoJson<Notes>("data/official/patch_notes.json")?.patches?.find((p) => p.gameVersion === live);
  return (entry?.champions ?? []).flatMap((c) => {
    const alias = BY_NAME.get(norm(c.name));
    return alias ? [alias] : [];
  });
}

export function poolChanged(before: string, live: string): string[] {
  return [...new Set([...augmentPoolChanged(before, live), ...mayhemChanged(live)])];
}

function augmentPoolChanged(before: string, live: string): string[] {
  const a = load(before);
  const b = load(live);
  if (!a || !b) return [];
  const pool = new Set(Object.values(b).flatMap((c) => Object.entries(c).flatMap(([id, [g]]) => (g >= 100 ? [id] : []))));
  return Object.entries(a).flatMap(([cid, rows]) => {
    const tot = Object.values(rows).reduce((s, [g]) => s + g, 0);
    const lost = Object.entries(rows).reduce((s, [id, [g]]) => s + (pool.has(id) ? 0 : g), 0);
    return tot && ALIAS[cid] && lost / tot >= POOL_CHANGE_SHARE ? [ALIAS[cid]] : [];
  });
}
