import "server-only";
import championIds from "@/data/champion-ids.json";
import { grade } from "./deepscore";
import { itemPages } from "./item-pages";
import { items as clientItems } from "./items";
import { aramhexLatest, shrunkLifts } from "./aramhex-real";
import { readRepoJson } from "./repo-data";

// Weapon of Destiny tab (/tier-list?tab=weapon-of-destiny): which Legendary item is best to make your Weapon of
// Destiny. Each takedown adds 200 gold worth of the item's own stats, shared equally among them. Since AramHex
// (2026-11-23) the tab ranks on real games: AramHex counts each champion's first Legendary item in games with the
// augment (its top items per champion, data/aramhex/patches/<patch>/destiny.json). An item's score is its win rate
// in those games above its champions' Weapon of Destiny average, shrunk by sample size (lib/aramhex-real.ts), so it
// doesn't just favour items strong champions buy. Correlated, not causal (Nico 2026-11-20). The stat value per
// takedown from data/estimates/weapon_of_destiny.py stays as the "Each takedown" column.

type Data = {
  patch: string;
  gold_per_takedown: number;
  items: Record<
    string,
    {
      per_takedown: Record<string, number>;
      share: number;
      value: number;
      best: string[];
    }
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
  /** Share of the listed Weapon of Destiny games (each champion's top few Weapons in AramHex) where it's the Weapon. */
  share: number;
  /** Real Weapon of Destiny games with it as the Weapon. */
  games: number;
  /** DeepScore, 0-100 against the other items with 50 average (lib/deepscore.ts grade): its win rate in Weapon of
   *  Destiny games above its champions' average, shrunk by sample size. */
  score: number;
  tier: string;
  /** What the score is cut from, for sorting ties. */
  rank: number;
  /** The champion who makes it their Weapon most often. */
  best: string | null;
};

type Destiny = Record<string, { all: [number, number]; items: Record<string, [number, number]> }>;
const ALIAS = new Map(Object.entries(championIds).map(([alias, key]) => [String(key), alias]));
const base10k = (i: number) => (i >= 100000 ? i % 10000 : i);

export function weaponOfDestiny(): { gold: number; rows: DestinyRow[] } | null {
  const data = readRepoJson<Data>("data/estimates/weapon_of_destiny.json");
  const real = aramhexLatest<Destiny>("destiny");
  if (!data || !real) return null;
  const pages = new Map<number, { id: number; slug: string | null; name: string; icon?: string }>(
    itemPages().map((p) => [base10k(p.id), p]),
  );
  // Legendary items without a page count too (Mayhem's Hubris is only in core builds).
  for (const [id, i] of clientItems()) if (!pages.has(base10k(id)) && real && Object.values(real).some((c) => String(base10k(id)) in c.items)) pages.set(base10k(id), { id, slug: null, name: i.name, icon: i.icon });
  // Per item: its games and wins, and the wins its champions would expect on average with the augment.
  const sum = new Map<number, { games: number; wins: number; expect: number; top: [string, number] | null }>();
  for (const [key, c] of Object.entries(real)) {
    const [g, w] = c.all;
    if (!g) continue;
    for (const [id, [n, k]] of Object.entries(c.items)) {
      const s0 = sum.get(Number(id)) ?? { games: 0, wins: 0, expect: 0, top: null };
      s0.games += n;
      s0.wins += k;
      s0.expect += (n * w) / g;
      const alias = ALIAS.get(key);
      if (alias && (!s0.top || n > s0.top[1])) s0.top = [alias, n];
      sum.set(Number(id), s0);
    }
  }
  const entries = [...sum].filter(([id, v]) => pages.has(id) && v.games > 0);
  if (!entries.length) return null;
  // Shares of the listed Weapons (AramHex lists each champion's top few).
  const total = entries.reduce((t, [, v]) => t + v.games, 0);
  const lifts = shrunkLifts(entries.map(([, v]) => ({ games: v.games, wins: v.wins, base: v.expect / v.games })));
  const grades = grade(lifts);
  return {
    gold: data.gold_per_takedown,
    rows: entries.map(([id, v], k) => {
      const page = pages.get(id)!;
      return {
        id: page.id,
        slug: page.slug,
        name: page.name,
        icon: page.icon ?? "",
        perTakedown: data.items[id]?.per_takedown ?? {},
        share: total ? v.games / total : 0,
        games: v.games,
        score: grades[k].deepScore,
        tier: grades[k].tier,
        rank: lifts[k],
        best: v.top?.[0] ?? null,
      };
    }),
  };
}

// By champion: each champion's best item to make its Weapon of Destiny, from the same real games: among its items
// with a real following (a quarter of its most made Weapon's games), the best win rate above the champion's
// Weapon of Destiny average, shrunk by sample size.

export type DestinyChampionRow = {
  /** Champion id, as the tables and pages use it ("MonkeyKing"). */
  champion: string;
  item: { id: number; slug: string; name: string; icon: string };
  /** DeepScore of the best item on this champion, 0-100 against every champion's best item. */
  score: number;
  /** Real Weapon of Destiny games with that item as the Weapon. */
  games: number;
  /** The second-best item, when there is one. */
  next: { id: number; slug: string; name: string; icon: string } | null;
};

export function destinyByChampion(): DestinyChampionRow[] {
  const real = aramhexLatest<Destiny>("destiny");
  if (!real) return [];
  const pages = new Map(itemPages().map((p) => [base10k(p.id), p]));
  const item = (id: number) => {
    const p = pages.get(id);
    return p && p.slug ? { id: p.id, slug: p.slug, name: p.name, icon: p.icon ?? "" } : null;
  };
  const all: { champion: string; id: number; games: number; wins: number; base: number }[] = [];
  for (const [key, c] of Object.entries(real)) {
    const champion = ALIAS.get(key);
    const [g, w] = c.all;
    if (!champion || !g) continue;
    for (const [id, [n, k]] of Object.entries(c.items)) if (n > 0 && item(Number(id))) all.push({ champion, id: Number(id), games: n, wins: k, base: w / g });
  }
  const lifts = shrunkLifts(all);
  const byChamp = new Map<string, { id: number; games: number; lift: number }[]>();
  all.forEach((r, k) => byChamp.set(r.champion, [...(byChamp.get(r.champion) ?? []), { id: r.id, games: r.games, lift: lifts[k] }]));
  const picks = [...byChamp].map(([champion, opts]) => {
    const top = Math.max(...opts.map((o) => o.games));
    const [first, ...rest] = [...opts].sort((a, b) => Number(b.games >= MIN_SHARE * top) - Number(a.games >= MIN_SHARE * top) || b.lift - a.lift);
    return { champion, best: first, next: rest[0] ?? null };
  });
  const grades = grade(picks.map((p) => p.best.lift));
  return picks.map((p, k) => ({
    champion: p.champion,
    item: item(p.best.id)!,
    score: grades[k].deepScore,
    games: p.best.games,
    next: p.next ? item(p.next.id) : null,
  }));
}

/** A champion's item counts as followed with at least this share of its most made Weapon's games (as builds). */
const MIN_SHARE = 0.25;
