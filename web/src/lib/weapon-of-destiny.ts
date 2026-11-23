import "server-only";
import championIds from "@/data/champion-ids.json";
import { followed, scoreRows } from "./card-score";
import { grade, trueSpread } from "./deepscore";
import { itemPages } from "./item-pages";
import { items as clientItems } from "./items";
import { readRepoJson } from "./repo-data";

// Weapon of Destiny tab (/tier-list?tab=weapon-of-destiny): which Legendary item is best to upgrade with the
// Weapon of Destiny augment. Each takedown adds 200 gold worth of the item's own stats, shared equally among
// them. The tab is "Predicted" and ranks by stat value from data/estimates/weapon_of_destiny.py: how much each
// of the item's stats is worth (most for Critical Strike Damage and Armor or Magic Penetration %) and how few
// items give it, shared among its stats. The stats feed can't tell which games had the augment, so win rates
// of builds that start with an item aren't the augment's and aren't used (Nico 2026-10-27).

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
  /** Estimated share of Weapon of Destiny games where it's the Weapon, for "Best with". */
  share: number;
  /** Stat value, 0-100 against the other items with 50 average (lib/deepscore.ts grade): what each takedown's
   *  gold is worth to it, its stats counted by rarity and worth and shared among them, so items with many
   *  stats spread it thin. */
  score: number;
  tier: string;
  /** What the score is cut from, for sorting ties. */
  rank: number;
  /** The champion who'd upgrade it most often. */
  best: string | null;
};

export function weaponOfDestiny(): { gold: number; rows: DestinyRow[] } | null {
  const data = readRepoJson<Data>("data/estimates/weapon_of_destiny.json");
  if (!data) return null;
  const pages = new Map<
    number,
    { id: number; slug: string | null; name: string; icon?: string }
  >(itemPages().map((p) => [p.id, p]));
  // Legendary items without a page count when some champion buys them first (Mayhem's Hubris, only in core builds).
  for (const [id, i] of clientItems())
    if (!pages.has(id) && data.items[id]?.share)
      pages.set(id, { id, slug: null, name: i.name, icon: i.icon });
  const entries = Object.entries(data.items).filter(([id]) =>
    pages.has(Number(id)),
  );
  if (!entries.length) return null;
  const grades = grade(entries.map(([, v]) => v.value));
  return {
    gold: data.gold_per_takedown,
    rows: entries.map(([id, v], k) => {
      const page = pages.get(Number(id))!;
      return {
        id: page.id,
        slug: page.slug,
        name: page.name,
        icon: page.icon ?? "",
        perTakedown: v.per_takedown,
        share: v.share,
        score: grades[k].deepScore,
        tier: grades[k].tier,
        rank: v.value,
        best: v.best.find((c) => c in championIds) ?? null,
      };
    }),
  };
}

// By champion: each champion's best Weapon of Destiny item from data/estimates/champion_upgrades.py, which upgrades
// every candidate (items the champion buys first, or in its popular build) in the Simulator. Ranked by the simulated
// gain alone, since the file's score also adds the item's first-item win rate, which isn't the augment's.

type Upgrades = {
  champions: Record<
    string,
    {
      weapon_of_destiny: {
        takedowns: number;
        best: number;
        options: { item: number; sim_gain: number }[];
      } | null;
    }
  >;
};

export type DestinyChampionRow = {
  /** Champion id, as the tables and pages use it ("MonkeyKing"). */
  champion: string;
  item: { id: number; slug: string; name: string; icon: string };
  /** Simulated: how much stronger the upgrades make the champion in fights, as a fraction. */
  power: number;
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
  const byKey = new Map(
    Object.entries(championIds).map(([alias, key]) => [String(key), alias]),
  );
  const rows: DestinyChampionRow[] = [];
  for (const [key, c] of Object.entries(data.champions)) {
    const wd = c.weapon_of_destiny;
    const champion = byKey.get(key);
    if (!wd || !champion) continue;
    const options = wd.options
      .filter((o) => pages.has(o.item))
      .sort((a, b) => b.sim_gain - a.sim_gain);
    const [best, second] = options;
    if (!best) continue;
    rows.push({
      champion,
      item: item(best.item)!,
      power: best.sim_gain / 100,
      next: second ? item(second.item) : null,
      takedowns: wd.takedowns,
    });
  }
  return rows;
}

// Real games (AramHex, data/aramhex/patches/<patch>/destiny.json): for every champion, its games with Weapon of
// Destiny and the first Legendary item each of those games upgraded, with wins. Replaces the Predicted stat-value
// ranking and the simulated "by champion" pick (Nico 2026-11-21: base all data on AramHex). Raw win rates stay off the
// site; items rank by DeepScore on their lead over what the same champions win with the augment on average.

// Each champion lists its three most upgraded items only, so rarer picks count only where they're in a top three.
type Destiny = Record<string, { all: [number, number]; items: Record<string, [number, number]> }>;

/** An item needs this share of all Weapon of Destiny games to be listed: below it one champion's niche pick tops the
 *  list for every champion (Thornmail, nearly all Rammus, read S on 16.23; sanity rule). */
const MIN_ITEM_SHARE = 0.002;

export type RealDestinyItem = Omit<DestinyRow, "perTakedown"> & {
  perTakedown: Record<string, number>;
  games: number;
};

export type RealDestinyChampion = {
  champion: string;
  /** The item most of its Weapon of Destiny games upgrade, and that share of them. */
  usual: { id: number; slug: string | null; name: string; icon: string; share: number };
  /** The best DeepScore among items with a real following (1/4 of the usual item's games), when it isn't the usual one. */
  best: { id: number; slug: string | null; name: string; icon: string; deepScore: number } | null;
  games: number;
};

function destinyPatch(): { patch: string; data: Destiny } | null {
  const idx = readRepoJson<{ patches: string[] }>("data/aramhex/patches/index.json");
  for (const p of [...(idx?.patches ?? [])].reverse()) {
    const data = readRepoJson<Destiny>(`data/aramhex/patches/${p}/destiny.json`);
    if (data && Object.keys(data).length) return { patch: p, data };
  }
  return null;
}

function itemLookup() {
  const pages = new Map<number, { id: number; slug: string | null; name: string; icon: string }>(
    itemPages().map((p) => [p.id, { id: p.id, slug: p.slug, name: p.name, icon: p.icon ?? "" }]),
  );
  for (const [id, i] of clientItems()) if (!pages.has(id)) pages.set(id, { id, slug: null, name: i.name, icon: i.icon ?? "" });
  return pages;
}

export function realDestiny(): { patch: string; gold: number; items: RealDestinyItem[]; champions: RealDestinyChampion[] } | null {
  const src = destinyPatch();
  if (!src) return null;
  const pages = itemLookup();
  const stats = readRepoJson<Data>("data/estimates/weapon_of_destiny.json");
  const byKey = new Map(Object.entries(championIds).map(([alias, key]) => [String(key), alias]));

  // By item: games, wins and the wins expected from each champion's own Weapon of Destiny win rate.
  const agg = new Map<number, { g: number; w: number; e: number; top: [string, number] | null }>();
  const champions: RealDestinyChampion[] = [];
  let allGames = 0;
  for (const [key, c] of Object.entries(src.data)) {
    const alias = byKey.get(key);
    const [ag, aw] = c.all;
    if (!alias || ag <= 0) continue;
    const base = aw / ag;
    allGames += ag;
    const rows = Object.entries(c.items)
      .map(([id, [g, w]]) => ({ id: Number(id), g, w }))
      .filter((r) => r.g > 0 && pages.has(r.id));
    for (const r of rows) {
      const a = agg.get(r.id) ?? { g: 0, w: 0, e: 0, top: null };
      a.g += r.g;
      a.w += r.w;
      a.e += r.g * base;
      const share = r.g / ag;
      if (r.g >= 100 && (!a.top || share > a.top[1])) a.top = [alias, share];
      agg.set(r.id, a);
    }
    if (!rows.length) continue;
    const usual = rows.reduce((x, y) => (y.g > x.g ? y : x));
    const scored = followed(scoreRows(rows.map((r) => ({ id: r.id, winRate: r.w / r.g, pickRate: r.g / ag, games: r.g }))));
    const top = scored[0];
    champions.push({
      champion: alias,
      usual: { ...pages.get(usual.id)!, share: usual.g / ag },
      best: top && top.id !== usual.id && top.deepScore !== undefined ? { ...pages.get(top.id)!, deepScore: top.deepScore } : null,
      games: ag,
    });
  }

  const listed = [...agg.entries()].filter(([, a]) => a.g >= MIN_ITEM_SHARE * allGames);
  if (!listed.length) return null;
  const lifts = listed.map(([, a]) => (a.w - a.e) / a.g);
  const vs = listed.map(([, a]) => 0.25 / a.g);
  const tau2 = trueSpread(lifts, vs);
  const shrunk = lifts.map((l, i) => (l * tau2) / (tau2 + vs[i]));
  const grades = grade(shrunk);
  const items: RealDestinyItem[] = listed.map(([id, a], i) => ({
    ...pages.get(id)!,
    perTakedown: stats?.items[id]?.per_takedown ?? {},
    share: a.g / allGames,
    score: grades[i].deepScore,
    tier: grades[i].tier,
    rank: shrunk[i],
    best: a.top?.[0] ?? null,
    games: a.g,
  }));
  return { patch: src.patch, gold: stats?.gold_per_takedown ?? 200, items, champions };
}
