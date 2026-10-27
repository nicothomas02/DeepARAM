import "server-only";
import championIds from "@/data/champion-ids.json";
import { grade, lowerBound } from "./deepscore";
import { itemPages } from "./item-pages";
import { items as clientItems } from "./items";
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
  /** Its item page; null for a Legendary item without one (Mayhem's Hubris is only in core builds). */
  slug: string | null;
  name: string;
  icon: string;
  /** Simulator stat key -> amount one takedown adds (fractions for percentages). */
  perTakedown: Record<string, number>;
  /** Estimated share of Weapon of Destiny games where it's the Weapon. */
  share: number;
  /** Estimated win rate as the Weapon minus what the same champions win anyway; null when none buys it first. */
  lift: number | null;
  /** 0-100 against the other items, 50 average (lib/deepscore.ts grade): what each takedown's gold is worth to it,
   *  its stats counted by rarity and worth and shared among them, so items with many stats spread it thin. */
  statValue: number;
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
  const pages = new Map<number, { id: number; slug: string | null; name: string; icon?: string }>(itemPages().map((p) => [p.id, p]));
  // Legendary items without a page count when some champion buys them first (Mayhem's Hubris, only in core builds).
  for (const [id, i] of clientItems()) if (!pages.has(id) && data.items[id]?.share) pages.set(id, { id, slug: null, name: i.name, icon: i.icon });
  const entries = Object.entries(data.items).filter(([id]) => pages.has(Number(id)));
  if (!entries.length) return null;
  const anticipated = data.anticipated ?? true;
  const bounds = anticipated ? new Map(entries.map(([id, v]) => [id, v.value])) : deepScore(entries);
  const grades = grade([...bounds.values()]);
  const graded = new Map([...bounds.keys()].map((id, k) => [id, grades[k]]));
  const values = grade(entries.map(([, v]) => v.value));
  return {
    gold: data.gold_per_takedown,
    anticipated,
    rows: entries.map(([id, v], k) => {
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
        statValue: values[k].deepScore,
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

// By champion: each champion's best Weapon of Destiny item from data/estimates/champion_upgrades.py, which upgrades
// every candidate (items the champion buys first, or in its popular build) in the Simulator and adds the item's real
// win rate as a first item. Score is in win rate points.

type Upgrades = {
  champions: Record<
    string,
    {
      weapon_of_destiny: {
        takedowns: number;
        best: number;
        options: { item: number; sim_gain: number; first_share: number; score: number }[];
      } | null;
    }
  >;
};

export type DestinyChampionRow = {
  /** Champion id, as the tables and pages use it ("MonkeyKing"). */
  champion: string;
  item: { id: number; slug: string; name: string; icon: string };
  /** Estimated win rate points from upgrading it, as a fraction (0.02 = 2 points). */
  boost: number;
  /** Simulated: how much stronger the upgrades make the champion in fights, as a fraction. */
  power: number;
  /** How often the champion already buys it as its first Legendary item. */
  share: number;
  /** The second-best item, when there is one. */
  next: { id: number; slug: string; name: string; icon: string } | null;
  /** Takedowns per game the upgrade was simulated with. */
  takedowns: number;
};

export function destinyByChampion(): DestinyChampionRow[] {
  const data = readRepoJson<Upgrades>("data/estimates/champion_upgrades.json");
  if (!data) return [];
  const pages = new Map(itemPages().map((p) => [p.id, p]));
  const item = (id: number) => {
    const p = pages.get(id);
    return p ? { id, slug: p.slug, name: p.name, icon: p.icon ?? "" } : null;
  };
  const byKey = new Map(Object.entries(championIds).map(([alias, key]) => [String(key), alias]));
  const rows: DestinyChampionRow[] = [];
  for (const [key, c] of Object.entries(data.champions)) {
    const wd = c.weapon_of_destiny;
    const champion = byKey.get(key);
    if (!wd || !champion) continue;
    const options = wd.options.filter((o) => pages.has(o.item)).sort((a, b) => b.score - a.score);
    const [best, second] = options;
    if (!best) continue;
    rows.push({
      champion,
      item: item(best.item)!,
      boost: best.score / 100,
      power: best.sim_gain / 100,
      share: best.first_share,
      next: second ? item(second.item) : null,
      takedowns: wd.takedowns,
    });
  }
  return rows;
}
