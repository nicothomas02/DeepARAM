import "server-only";
import championIds from "@/data/champion-ids.json";
import { grade, lowerBound } from "./deepscore";
import { itemPages } from "./item-pages";
import { readRepoJson } from "./repo-data";

// Weapon of Destiny tab (/tier-list?tab=weapon-of-destiny): which Legendary item is best to upgrade with the
// Weapon of Destiny augment. Each takedown adds 200 gold worth of the item's own stats, shared equally among
// them. data/estimates/weapon_of_destiny.py estimates how often each item would be the Weapon (the first
// Legendary item of the champions who take the augment) and how those builds win. Until the augment has real
// games the tab is "Anticipated" and ranks by valuable stats: how much each of the item's stats is worth
// (most for Critical Strike Damage and Armor or Magic Penetration %) and how few items give it (Nico
// 2026-10-23). Once it has games it ranks by a DeepScore from share and lift, the same way the Items tab does.

type Data = {
  patch: string;
  anticipated?: boolean;
  gold_per_takedown: number;
  items: Record<
    string,
    { per_takedown: Record<string, number>; share: number; lift: number | null; rare: number; value: number; best: string[] }
  >;
};

export type DestinyRow = {
  id: number;
  slug: string;
  name: string;
  icon: string;
  /** Simulator stat key -> amount one takedown adds (fractions for percentages). */
  perTakedown: Record<string, number>;
  /** Estimated share of Weapon of Destiny games where it's the Weapon. */
  share: number;
  /** Estimated win rate as the Weapon minus what the same champions win anyway; null when none buys it first. */
  lift: number | null;
  /** 0-100: how rare its stats are among Legendary items, 100 for the rarest mix. */
  rare: number;
  /** 0-100 against the other items (lib/deepscore.ts): stat value while anticipated, else DeepScore; null when
   *  it has no DeepScore (no champion buys it first). */
  score: number | null;
  tier: string | null;
  /** What the score is cut from, for sorting ties: the stats' worth while anticipated, else the low end of its
   *  likely win rate. */
  rank: number | null;
  /** The champion who'd upgrade it most often. */
  best: string | null;
};

const MEDIAN_GAMES = 1000; // pseudo-games for an item of median share, as on the Items tab
const PRIOR = 0.25; // the average's weight, in median items' worth of games

export function weaponOfDestiny(): { gold: number; anticipated: boolean; rows: DestinyRow[] } | null {
  const data = readRepoJson<Data>("data/estimates/weapon_of_destiny.json");
  if (!data) return null;
  const pages = new Map(itemPages().map((p) => [p.id, p]));
  const entries = Object.entries(data.items).filter(([id]) => pages.has(Number(id)));
  if (!entries.length) return null;
  const anticipated = data.anticipated ?? true;
  const bounds = anticipated ? new Map(entries.map(([id, v]) => [id, v.value])) : deepScore(entries);
  const grades = grade([...bounds.values()]);
  const graded = new Map([...bounds.keys()].map((id, k) => [id, grades[k]]));
  const top = Math.max(...entries.map(([, v]) => v.rare));
  return {
    gold: data.gold_per_takedown,
    anticipated,
    rows: entries.map(([id, v]) => {
      const page = pages.get(Number(id))!;
      const best = v.best.find((c) => c in championIds) ?? null;
      const g = graded.get(id);
      return {
        id: page.id,
        slug: page.slug,
        name: page.name,
        icon: page.icon ?? "",
        perTakedown: v.per_takedown,
        share: v.share,
        lift: anticipated || bounds.has(id) ? v.lift : null,
        rare: Math.round((v.rare / top) * 100),
        score: g?.deepScore ?? null,
        tier: g?.tier ?? null,
        rank: bounds.get(id) ?? null,
        best,
      };
    }),
  };
}

type Entry = [string, Data["items"][string]];

/** DeepScore: each item's win rate pulled toward the average by how rarely it's the Weapon, then its low end. */
function deepScore(entries: Entry[]): Map<string, number> {
  const rated = entries.filter(([, v]) => v.lift !== null && v.share > 0);
  const shares = rated.map(([, v]) => v.share).sort((a, b) => a - b);
  const median = shares[Math.floor(shares.length / 2)] || 1;
  const total = shares.reduce((a, b) => a + b, 0) || 1;
  const mean = 0.5 + rated.reduce((s, [, v]) => s + v.lift! * v.share, 0) / total;
  return new Map(rated.map(([id, v]) => [id, lowerBound(0.5 + v.lift!, (v.share / median) * MEDIAN_GAMES, mean, PRIOR * MEDIAN_GAMES)]));
}
