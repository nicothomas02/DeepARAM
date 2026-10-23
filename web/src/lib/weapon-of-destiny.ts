import "server-only";
import championIds from "@/data/champion-ids.json";
import { grade } from "./deepscore";
import { itemPages } from "./item-pages";
import { readRepoJson } from "./repo-data";

// Weapon of Destiny tab (/tier-list?tab=weapon-of-destiny): which Legendary item is best to upgrade with the
// Weapon of Destiny augment. Each takedown adds 200 gold worth of the item's own stats, shared equally among
// them. data/estimates/weapon_of_destiny.py estimates how often each item would be the Weapon (the first
// Legendary item of the champions likely to take the augment) and how much of the upgrade goes into stats
// few items give; the tier weighs the two equally.

type Data = {
  patch: string;
  gold_per_takedown: number;
  items: Record<string, { per_takedown: Record<string, number>; share: number; rare: number; best: string[] }>;
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
  /** 0-100: how rare its stats are among Legendary items, 100 for the rarest mix. */
  rare: number;
  tier: string;
  /** Both measures as z-scores, added: what the tier is cut from. */
  value: number;
  /** The champion who'd upgrade it most often. */
  best: string | null;
};

// Items no champion buys first still get a share, so the log scale has a floor.
const FLOOR = 0.001;

export function weaponOfDestiny(): { gold: number; rows: DestinyRow[] } | null {
  const data = readRepoJson<Data>("data/estimates/weapon_of_destiny.json");
  if (!data) return null;
  const pages = new Map(itemPages().map((p) => [p.id, p]));
  const entries = Object.entries(data.items).filter(([id]) => pages.has(Number(id)));
  if (!entries.length) return null;
  const z = (xs: number[]) => {
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length) || 1;
    return xs.map((x) => (x - mean) / sd);
  };
  const used = z(entries.map(([, v]) => Math.log(v.share + FLOOR)));
  const rare = z(entries.map(([, v]) => v.rare));
  const graded = grade(entries.map((_, k) => used[k] + rare[k]));
  const top = Math.max(...entries.map(([, v]) => v.rare));
  return {
    gold: data.gold_per_takedown,
    rows: entries.map(([id, v], k) => {
      const page = pages.get(Number(id))!;
      const best = v.best.find((c) => c in championIds) ?? null;
      return {
        id: page.id,
        slug: page.slug,
        name: page.name,
        icon: page.icon ?? "",
        perTakedown: v.per_takedown,
        share: v.share,
        rare: Math.round((v.rare / top) * 100),
        tier: graded[k].tier,
        value: Math.round((used[k] + rare[k]) * 1000) / 1000,
        best,
      };
    }),
  };
}
