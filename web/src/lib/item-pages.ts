import "server-only";
import championIds from "@/data/champion-ids.json";
import { augmentSlug } from "./augments";
import { champName } from "./highlights";
import { liveWithChange } from "./champions";
import { grade, lowerBound } from "./deepscore";
import { ITEM_TIERS, inMayhem, itemClasses, itemTier, items, ranked, rewardItems, transformsInto, type ItemTier } from "./items";
import { tagsFor } from "./item-tags";
import { ddVersion } from "./dd-swap";
import { readRepoJson } from "./repo-data";

// One page per item in the Mayhem shop (/items/<slug>): every item sold on Howling Abyss, the items
// augments hand out, and anything champions build. Stats and cost come from the client's item list, the
// champions who build it most from data/cn/builds/<id>.json.

const IDS = championIds as Record<string, number>;

type Entry = { items: number[]; pick_rate: number; win_rate?: number };
type Builds = { items?: Record<string, Entry[]> };

export type ItemPage = {
  id: number;
  slug: string;
  name: string;
  icon?: string;
  cost: number;
  stats: string[];
  /** lib/item-tags.ts keys */
  tags: string[];
  /** How widely it's built: its pick rates summed over the champions who build it. */
  popularity: number;
  builders: { id: string; name: string; pickRate: number; winRate: number | null }[];
  tier: ItemTier;
  /** 0-100 against the other items of its tier (lib/deepscore.ts); null when no builder has a win rate. */
  deepScore: number | null;
};

const MEDIAN_GAMES = 1000; // pseudo-games for an item of median popularity, as on the Tier List
const PRIOR = 0.25; // the average's weight, in median items' worth of games

// How much an item lifts the win rate of the champions who build it, weighted by how often each one
// does, so items that strong champions happen to buy don't look better than they are.
function lifts(builders: ItemPage["builders"]) {
  const champs = new Map(liveWithChange().live.map((c) => [c.name, c]));
  let w = 0;
  let sum = 0;
  for (const b of builders) {
    const c = champs.get(b.id);
    if (!c || b.winRate === null) continue;
    const weight = c.pick_rate * b.pickRate;
    w += weight;
    sum += weight * (b.winRate - c.win_rate);
  }
  return w ? { lift: sum / w, weight: w } : null;
}

// An item's builders plus those of the items that transform into it (Archangel's Staff counts toward Seraph's
// Embrace), summed per champion with win rates weighted by pick rate.
function withSources(id: number, all: Map<number, ItemPage["builders"]>): ItemPage["builders"] {
  const sources = [...all.keys()].filter((s) => transformsInto(s) === id);
  if (!sources.length) return all.get(id) ?? [];
  const byChamp = new Map<string, { b: ItemPage["builders"][number]; wins: number; rated: number }>();
  for (const b of [id, ...sources].flatMap((s) => all.get(s) ?? [])) {
    const m = byChamp.get(b.id) ?? { b: { ...b, pickRate: 0, winRate: null }, wins: 0, rated: 0 };
    m.b.pickRate = Math.min(1, m.b.pickRate + b.pickRate);
    if (b.winRate !== null) {
      m.wins += b.winRate * b.pickRate;
      m.rated += b.pickRate;
    }
    m.b.winRate = m.rated ? m.wins / m.rated : null;
    byChamp.set(b.id, m);
  }
  return [...byChamp.values()].map((m) => m.b);
}

function scoreTiers(list: ItemPage[], all: Map<number, ItemPage["builders"]>) {
  for (const tier of ITEM_TIERS) {
    // Components and items that transform keep no DeepScore (lib/items.ts ranked).
    const group = list
      .filter((i) => i.tier === tier && ranked(i.id))
      .map((i) => ({ i, l: lifts(withSources(i.id, all)) }))
      .filter((x): x is { i: ItemPage; l: { lift: number; weight: number } } => x.l !== null);
    if (!group.length) continue;
    const weights = group.map((x) => x.l.weight).sort((a, b) => a - b);
    const median = weights[Math.floor(weights.length / 2)] || 1;
    const total = group.reduce((s, x) => s + x.l.weight, 0);
    const mean = 0.5 + group.reduce((s, x) => s + x.l.lift * x.l.weight, 0) / total;
    const grades = grade(group.map((x) => lowerBound(0.5 + x.l.lift, (x.l.weight / median) * MEDIAN_GAMES, mean, PRIOR * MEDIAN_GAMES)));
    group.forEach((x, k) => (x.i.deepScore = grades[k].deepScore));
  }
}

// "<stats>75 Attack Damage<br>25% Critical Strike Chance</stats>" -> ["75 Attack Damage", "25% Critical Strike Chance"]
function statLines(description: string) {
  const stats = description.match(/<stats>([\s\S]*?)<\/stats>/i)?.[1] ?? "";
  return stats
    .split(/<br\s*\/?>/i)
    .map((l) => l.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

type DdItem = {
  maps?: Record<string, boolean>;
  gold?: { total: number; purchasable: boolean };
  requiredChampion?: string;
};

/** Every item ARAM Mayhem's shop sells (lib/items.ts inMayhem): priced, purchasable and not tied to one
 *  champion. */
function shopItems(info: Map<number, { inStore?: boolean }>): number[] {
  const dd = readRepoJson<{ data: Record<string, DdItem> }>(`web/public/assets/dd/${ddVersion}/data/en_US/item.json`)?.data ?? {};
  return Object.entries(dd).flatMap(([k, v]) => {
    const id = Number(k);
    const sold = v.maps?.["12"] && v.gold?.purchasable && v.gold.total > 0 && !v.requiredChampion && info.get(id)?.inStore !== false;
    return sold && inMayhem(id) ? [id] : [];
  });
}

let cache: ItemPage[] | null = null;
export function itemPages(): ItemPage[] {
  if (cache) return cache;
  const all = items();
  const raw = readRepoJson<
    { id: number; description?: string; priceTotal?: number; categories?: string[]; inStore?: boolean; displayInItemSets?: boolean }[]
  >(
    "web/public/assets/cd/latest/plugins/rcp-be-lol-game-data/global/default/v1/items.json",
  );
  const info = new Map((raw ?? []).map((i) => [i.id, i]));
  // How often each champion buys each item. Within the starting, boots and other lists, the entries an
  // item appears in are summed (single items and combinations alike), with their win rates weighted by
  // pick rate; the list where it's most common counts. Combinations matter for items rarely bought on
  // their own (Gluttonous Greaves, most components).
  const builders = new Map<number, ItemPage["builders"]>();
  for (const [alias, cid] of Object.entries(IDS)) {
    const b = readRepoJson<Builds>(`data/cn/builds/${cid}.json`)?.items ?? {};
    const best = new Map<number, { pick: number; wins: number; rated: number }>();
    for (const list of [b.other ?? [], b.boots ?? [], b.starting ?? []]) {
      const sums = new Map<number, { pick: number; wins: number; rated: number }>();
      for (const e of list) {
        for (const id of new Set(e.items)) {
          if (rewardItems().has(id) || !inMayhem(id)) continue;
          const m = sums.get(id) ?? { pick: 0, wins: 0, rated: 0 };
          m.pick += e.pick_rate;
          if (e.win_rate !== undefined) {
            m.wins += e.win_rate * e.pick_rate;
            m.rated += e.pick_rate;
          }
          sums.set(id, m);
        }
      }
      for (const [id, m] of sums) if (m.pick > (best.get(id)?.pick ?? 0)) best.set(id, m);
    }
    for (const [id, m] of best) {
      const row = { id: alias, name: champName(alias), pickRate: Math.min(1, m.pick), winRate: m.rated ? m.wins / m.rated : null };
      builders.set(id, [...(builders.get(id) ?? []), row]);
    }
  }
  const slugs = new Set<string>();
  const ids = new Set([...builders.keys(), ...shopItems(info), ...rewardItems()].filter((id) => inMayhem(id) || rewardItems().has(id)));
  cache = [...ids]
    .map((id) => all.get(id))
    .filter((i): i is NonNullable<typeof i> => Boolean(i))
    .map((i) => {
      let slug = augmentSlug(i.name);
      if (slugs.has(slug)) slug = `${slug}-${i.id}`;
      slugs.add(slug);
      return {
        id: i.id,
        slug,
        name: i.name,
        icon: i.icon,
        cost: info.get(i.id)?.priceTotal ?? 0,
        stats: statLines(info.get(i.id)?.description ?? ""),
        tags: tagsFor([...(info.get(i.id)?.categories ?? []), ...itemClasses(i.id).map((c) => `class:${c}`)]),
        popularity: (builders.get(i.id) ?? []).reduce((s, b) => s + b.pickRate, 0),
        builders: [...(builders.get(i.id) ?? [])].sort((x, y) => y.pickRate - x.pickRate).slice(0, 10),
        tier: itemTier(i.id),
        deepScore: null as number | null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  scoreTiers(cache, builders);
  return cache;
}

export const itemBySlug = (slug: string) => itemPages().find((i) => i.slug === slug) ?? null;
