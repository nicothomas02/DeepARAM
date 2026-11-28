import "server-only";
import championIds from "@/data/champion-ids.json";
import itemFit from "@/data/item-fit.json";
import { aramhexLatest } from "./aramhex-real";
import { readRepoJson } from "./repo-data";
import { whyBest, type WhyData } from "./engine/build-engine";
import { mechanismProfiles, whatItDoes, type Effect } from "./mechanisms";

// The data behind the build engine's one-line "why it's best" (lib/engine whyBest; research/why-best section 5,
// Nico approved 2026-11-23). Served at /data/why-best.json for the apps. Facts only, no win rates:
// - follow: items most of a champion's players end the game with (AramHex, latest patch, share >= 50%);
// - kit: the 10 items whose fit a champion's kit explains, and which side of that trait each champion is on.

const ALIAS = new Map(Object.entries(championIds as Record<string, number>).map(([alias, id]) => [String(id), alias]));
const base = (i: number) => (i >= 100000 ? i % 10000 : i);

type Champ = { champion_id: number; ranged: boolean; cn?: { damage_taken_share?: number; phys_share?: number } };

/** A champion's kit traits against the champions' average (as in whyBestData): deals mostly physical damage, takes
 *  more of its team's damage than most. Null when the champion has no data. */
let traitCache: Map<number, { physical: boolean; tank: boolean }> | null = null;
export function championTraits(championId: number): { physical: boolean; tank: boolean } | null {
  if (!traitCache) {
    // read once: the file is large and every champion page asks
    const champs = readRepoJson<{ champions: Champ[] }>("simulator/data/champions.json")?.champions ?? [];
    const mean = (f: (c: Champ) => number | undefined) => {
      const v = champs.map(f).filter((x): x is number => typeof x === "number");
      return v.reduce((a, b) => a + b, 0) / (v.length || 1);
    };
    const phys = mean((x) => x.cn?.phys_share), tank = mean((x) => x.cn?.damage_taken_share);
    traitCache = new Map();
    for (const c of champs)
      if (c.cn?.phys_share !== undefined && c.cn.damage_taken_share !== undefined)
        traitCache.set(c.champion_id, { physical: c.cn.phys_share > phys, tank: c.cn.damage_taken_share > tank });
  }
  return traitCache.get(championId) ?? null;
}

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

export type BuildWhy = {
  /** Build items most of the champion's players end the game with. */
  follow: number[];
  /** One reason for each other item that has one: its kit trait, or what it does (estimated). */
  lines: { id: number; kit?: "physical" | "carry" | "tank" | "melee"; effects?: Effect[] }[];
};

let cached: WhyData | undefined;
/**
 * The champion card's "Why these items" (Nico approved one-line reasons, 2026-11-23): the build engine's whyBest for
 * each item of the card's build, so site and apps give the same reason. The site picks no augments, so no augment
 * reasons here; texts are rebuilt from the reason kind so they translate. Items with no reason are left out.
 */
export function buildWhy(alias: string, ids: number[]): BuildWhy {
  cached ??= whyBestData();
  const profiles = mechanismProfiles() as Parameters<typeof whyBest>[5];
  const out: BuildWhy = { follow: [], lines: [] };
  for (const id of ids) {
    const r = whyBest(id, alias, alias, [], cached, profiles);
    if (!r) continue;
    if (r.kind === "follow") out.follow.push(id);
    else if (r.kind === "kit") out.lines.push({ id, kit: cached.kit[String(base(id))] as BuildWhy["lines"][number]["kit"] });
    else if (r.kind === "does") {
      // Only a gain is a reason to buy it: "-8% healing" (Hubris) explains nothing (2026-11-23, told the engine thread).
      const effects = whatItDoes("items", base(id), { max: 5 }).filter((e) => e.n.startsWith(e.metric === "deaths" ? "-" : "+")).slice(0, 1);
      if (effects.length) out.lines.push({ id, effects });
    }
  }
  return out;
}
