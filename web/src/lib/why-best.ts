import "server-only";
import championIds from "@/data/champion-ids.json";
import itemFit from "@/data/item-fit.json";
import { aramhexLatest } from "./aramhex-real";
import { readRepoJson } from "./repo-data";
import type { WhyData } from "./engine/build-engine";

// The data behind the build engine's one-line "why it's best" (lib/engine whyBest; research/why-best section 5,
// Nico approved 2026-11-23). Served at /data/why-best.json for the apps. Facts only, no win rates:
// - follow: items most of a champion's players end the game with (AramHex, latest patch, share >= 50%);
// - kit: the 10 items whose fit a champion's kit explains, and which side of that trait each champion is on.

const ALIAS = new Map(Object.entries(championIds as Record<string, number>).map(([alias, id]) => [String(id), alias]));
const base = (i: number) => (i >= 100000 ? i % 10000 : i);

type Champ = { champion_id: number; ranged: boolean; cn?: { damage_taken_share?: number; phys_share?: number } };

export function whyBestData(): WhyData {
  const follow: WhyData["follow"] = {};
  const items = aramhexLatest<Record<string, { all: [number, number]; items: Record<string, [number, number]> }>>("items") ?? {};
  for (const [key, c] of Object.entries(items)) {
    const alias = ALIAS.get(key);
    const games = c.all?.[0] ?? 0;
    if (!alias || !games) continue;
    const shares: Record<string, number> = {};
    for (const [id, [n]] of Object.entries(c.items)) {
      const b = String(base(Number(id)));
      shares[b] = (shares[b] ?? 0) + n / games;
    }
    const most = Object.entries(shares).filter(([, s]) => s >= 0.5);
    if (most.length) follow[alias] = Object.fromEntries(most.map(([id, s]) => [id, Math.round(s * 100) / 100]));
  }
  // Kit traits, each against the champions' average (the study fits standardized traits): Riot game data via the
  // Simulator's champion file, with 101's damage-taken and physical shares.
  const champs = readRepoJson<{ champions: Champ[] }>("simulator/data/champions.json")?.champions ?? [];
  const mean = (f: (c: Champ) => number | undefined) => {
    const v = champs.map(f).filter((x): x is number => typeof x === "number");
    return v.reduce((a, b) => a + b, 0) / (v.length || 1);
  };
  const phys = mean((c) => c.cn?.phys_share), tank = mean((c) => c.cn?.damage_taken_share);
  const traits: WhyData["traits"] = {};
  for (const c of champs) {
    const alias = ALIAS.get(String(c.champion_id));
    if (!alias || c.cn?.phys_share === undefined || c.cn?.damage_taken_share === undefined) continue;
    traits[alias] = { physical: c.cn.phys_share > phys, tank: c.cn.damage_taken_share > tank, melee: !c.ranged };
  }
  return { follow, kit: itemFit.items as WhyData["kit"], traits };
}
