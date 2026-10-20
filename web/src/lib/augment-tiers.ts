import "server-only";
import { readFileSync } from "node:fs";
import { augmentPages } from "./augments";
import { repoHas, repoPath, readRepoJson } from "./repo-data";
import championIds from "@/data/champion-ids.json";
import { grade, lowerBound } from "./deepscore";
import { officialStyles } from "./build-tags";

// Augment tier list (/augments): every live augment ranked S to D against the others of its rarity
// (a selection only ever offers one rarity), plus the build styles it fits, for the style filter.
//
// Tiers come from DeepScore (lib/deepscore.ts), against the other augments of the rarity. An augment's
// win rate is first judged against what the champions who take it win anyway: its "baseline" is those
// champions' win rates, weighted by how many of their games include it. A strong champion's favourite
// then only scores well if it wins more than that champion usually does. The result is pulled toward
// the rarity's average, more strongly the less often the augment is picked, and scored at its low end.
//
// Styles: an augment fits a style when champions who play that style list it among that style's
// augments (champions/data.js "Builds by style"), or when its internal name names the style. The game's own
// build tags (lib/build-tags.ts) replace both for the augments that have them.

export const STYLES = {
  crit: "Crit",
  onhit: "On-hit",
  ap: "AP",
  lethality: "Lethality",
  fighter: "AD",
  tank: "Tank",
  enchanter: "Enchanter",
} as const;
export type Style = keyof typeof STYLES;

// Internal-name patterns, as in champions/build_data.py.
const NAME_STYLE: Record<Style, RegExp> = {
  crit: /crit/,
  onhit: /onhit|attackspeed|dualwield|deft/,
  ap: /abilitypower|magic|witch|warlock|mage/,
  lethality: /lethality|armorpen|assassin|execute/,
  fighter: /omnivamp|lifesteal|vamp|fighter|juggernaut/,
  tank: /health|armor|resist|tank|maxhp|colossus/,
  enchanter: /heal|shield|ally|allies|support/,
};

export type TierAug = {
  id: number;
  name: string;
  href: string;
  rarity: "silver" | "gold" | "prismatic";
  tier: string;
  /** 0-100, 50 is average for the rarity (lib/deepscore.ts). */
  deepScore: number;
  /** Win rate minus what the champions who take it win anyway, in points. */
  lift: number;
  winRate: number;
  pickRate: number;
  styles: Style[];
};

type Raw = { augment_id: number; key?: string; tier?: string; pick_rate: number; win_rate: number };
type ChampsData = { champions: { builds?: { styles?: { style: string; augments?: number[] }[] } }[] };

const PRIOR = 0.25; // the average's weight, in "median augments' worth" of picks
const MEDIAN_GAMES = 1000; // pseudo-games for an augment of median popularity, as for champions

type ChampRow = { champion_id: number; win_rate: number; pick_rate: number };
type Builds = { augments?: { all?: { id: number; pick_rate: number }[] } };

/** Per augment: the win rate the champions who take it have anyway, weighted by their games with it. */
function baselines(): Map<number, number> {
  const champs = readRepoJson<{ champions: ChampRow[] }>("data/cn/champions.json")?.champions ?? [];
  const sums = new Map<number, [number, number]>();
  for (const id of Object.values(championIds as Record<string, number>)) {
    const c = champs.find((x) => x.champion_id === id);
    const b = c && readRepoJson<Builds>(`data/cn/builds/${id}.json`);
    for (const a of b?.augments?.all ?? []) {
      const w = c!.pick_rate * a.pick_rate;
      const [s, n] = sums.get(a.id) ?? [0, 0];
      sums.set(a.id, [s + c!.win_rate * w, n + w]);
    }
  }
  return new Map([...sums].filter(([, [, n]]) => n > 0).map(([id, [s, n]]) => [id, s / n]));
}

function styleVotes(): Map<number, Record<string, number>> {
  const out = new Map<number, Record<string, number>>();
  if (!repoHas("champions/data.js")) return out;
  const js = readFileSync(repoPath("champions/data.js"), "utf8");
  const data = JSON.parse(js.slice(js.indexOf("{"), js.lastIndexOf("}") + 1)) as ChampsData;
  for (const c of data.champions)
    for (const s of c.builds?.styles ?? [])
      for (const id of s.augments ?? []) {
        const v = out.get(id) ?? {};
        v[s.style] = (v[s.style] ?? 0) + 1;
        out.set(id, v);
      }
  return out;
}

let cache: TierAug[] | null = null;
export function augmentTiers(): TierAug[] {
  if (cache) return cache;
  const raw = new Map((readRepoJson<{ augments: Raw[] }>("data/cn/augments.json")?.augments ?? []).map((a) => [a.augment_id, a]));
  const votes = styleVotes();
  const base = baselines();
  const pages = augmentPages();
  const out: TierAug[] = [];
  for (const rarity of ["silver", "gold", "prismatic"] as const) {
    const group = pages.filter((a) => a.tier === rarity);
    if (!group.length) continue;
    const picks = group.map((a) => a.pickRate).sort((x, y) => x - y);
    const median = picks[Math.floor(picks.length / 2)] || 1;
    const total = group.reduce((s, a) => s + a.pickRate, 0) || 1;
    const mean = group.reduce((s, a) => s + a.winRate * a.pickRate, 0) / total;
    // Judged against its champions: the win rate it would have if those champions were average.
    const usual = group.reduce((s, a) => s + (base.get(a.id) ?? mean) * a.pickRate, 0) / total;
    const adjusted = (a: (typeof group)[number]) => a.winRate - ((base.get(a.id) ?? usual) - usual);
    const scored = group
      .map((a) => ({ a, score: lowerBound(adjusted(a), (a.pickRate / median) * MEDIAN_GAMES, mean, PRIOR * MEDIAN_GAMES) }))
      .sort((x, y) => y.score - x.score);
    const grades = grade(scored.map((x) => x.score));
    scored.forEach(({ a }, i) => {
      const key = (raw.get(a.id)?.key ?? "").replace(/^ARAM_/, "").toLowerCase();
      const v = votes.get(a.id) ?? {};
      const seen = Object.values(v).reduce((s, n) => s + n, 0);
      // The game's own build tags win (lib/build-tags.ts); otherwise champions' style lists and the name.
      const styles =
        officialStyles(a.id) ?? (Object.keys(STYLES) as Style[]).filter((s) => (v[s] ?? 0) >= Math.max(2, seen * 0.25) || NAME_STYLE[s].test(key));
      out.push({
        id: a.id,
        name: a.name,
        href: `/augments/${a.slug}`,
        rarity,
        ...grades[i],
        lift: a.winRate - (base.get(a.id) ?? a.winRate),
        winRate: a.winRate,
        pickRate: a.pickRate,
        // An augment that fits nearly every style says nothing about any of them.
        styles: styles.length <= 3 ? styles : [],
      });
    });
  }
  cache = out;
  return out;
}
