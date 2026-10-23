import "server-only";
import championIds from "@/data/champion-ids.json";
import { grade } from "./deepscore";
import { itemPages } from "./item-pages";
import { readRepoJson } from "./repo-data";

// Weapon of Destiny tab (/tier-list?tab=weapon-of-destiny): which Legendary item is best to upgrade with the
// Weapon of Destiny augment. Each takedown adds 200 gold worth of the item's own stats, shared equally among
// them; data/estimates/weapon_of_destiny.py simulates the champions who buy each item first with and without
// half a typical game's takedowns of upgrades.

type Sim = { champ: string; first: number; dps: number; up_dps: number; alive: number; up_alive: number };
type Data = {
  patch: string;
  takedowns: number;
  gold_per_takedown: number;
  items: Record<string, { per_takedown: Record<string, number>; sims: Sim[] }>;
};

export type DestinyRow = {
  id: number;
  slug: string;
  name: string;
  icon: string;
  /** Simulator stat key -> amount one takedown adds (fractions for percentages). */
  perTakedown: Record<string, number>;
  /** Median gains over the item's simulated buyers, as shares (0.2 = 20% more). */
  fight: number | null;
  dps: number | null;
  alive: number | null;
  tier: string | null;
  score: number | null;
  /** The buyer it helps most. */
  best: string | null;
};

const ALIAS = new Map(Object.keys(championIds).map((a) => [a.toLowerCase(), a]));

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Damage dealt over a fight: fights last until the champion dies, so damage per second times time alive.
const fightGain = (s: Sim) => (s.up_dps * s.up_alive) / (s.dps * s.alive) - 1;

export function weaponOfDestiny(): { takedowns: number; gold: number; rows: DestinyRow[] } | null {
  const data = readRepoJson<Data>("data/estimates/weapon_of_destiny.json");
  if (!data) return null;
  const pages = new Map(itemPages().map((p) => [p.id, p]));
  const rows: DestinyRow[] = Object.entries(data.items).flatMap(([id, v]) => {
    const page = pages.get(Number(id));
    if (!page) return [];
    const sims = v.sims.filter((s) => s.dps > 0 && s.alive > 0 && ALIAS.has(s.champ.toLowerCase()));
    const top = [...sims].sort((a, b) => fightGain(b) - fightGain(a))[0];
    return [
      {
        id: page.id,
        slug: page.slug,
        name: page.name,
        icon: page.icon ?? "",
        perTakedown: v.per_takedown,
        fight: median(sims.map(fightGain)),
        dps: median(sims.map((s) => s.up_dps / s.dps - 1)),
        alive: median(sims.map((s) => s.up_alive / s.alive - 1)),
        tier: null,
        score: null,
        best: top ? ALIAS.get(top.champ.toLowerCase())! : null,
      },
    ];
  });
  // Tiers on the log scale, so a few sustain items that double a fight's damage don't flatten the rest.
  const scored = rows.filter((r) => r.fight !== null);
  grade(scored.map((r) => Math.log1p(r.fight!))).forEach((g, k) => {
    scored[k].tier = g.tier;
    scored[k].score = g.deepScore;
  });
  return { takedowns: data.takedowns, gold: data.gold_per_takedown, rows };
}
