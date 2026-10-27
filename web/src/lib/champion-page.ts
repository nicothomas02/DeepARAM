import "server-only";
import { readFileSync } from "node:fs";
import championIds from "@/data/champion-ids.json";
import augmentNames from "@/data/augment-names.json";
import { liveWithChange } from "./champions";
import { grade, lowerBound } from "./deepscore";
import {
  ITEM_TIERS,
  itemTier,
  items,
  rewardItems,
  type ItemTier,
} from "./items";
import { repoHas, repoPath, readRepoJson } from "./repo-data";
import { matesOf, type Mate } from "./duos";
import { officialStyleLabels } from "./build-tags";

// The ranked tables on a champion page (/champions/<Alias>): skill orders, item paths, augments,
// teammates, Mayhem's ability changes and base stats. Every row with a win rate also carries its
// "win lift", the row's win rate minus the champion's own, so a build that beats the champion's
// average stands out. Data: data/cn/builds/<id>.json (builds), the Duos list (teammates, lib/duos.ts) and
// champions/data.js (ability changes, base stats, build styles).

const IDS = championIds as Record<string, number>;
const AUGS = augmentNames as Record<string, string>;

/** A pair only counts as a teammate once it shows up in at least this share of games. */
export const MIN_PAIR_PICK = 0.008;

type Raw = { items: number[]; pick_rate: number; win_rate?: number };
type Builds = {
  items?: Partial<
    Record<"starting" | "boots" | "core" | "other" | "full_builds", Raw[]>
  >;
  skills?: {
    max_order: string[];
    pick_rate: number;
    win_rate: number;
    orders?: { order: string[] }[];
  }[];
  augments?: Record<
    string,
    { id: number; pick_rate: number; grade?: string }[]
  >;
};
export type Rated = { winRate: number; pickRate: number; lift: number };
export type ItemRow = Rated & {
  items: number[];
  deepScore?: number;
  tier?: ItemTier;
  /** Core builds: the boots that go with the core, shown first. */
  boots?: number;
};
/** The options for one item slot after the core (4th, 5th, 6th), best DeepScore first. */
export type LateSlot = { slot: number; options: ItemRow[] };
export type SkillRow = Rated & { max: string[]; levels: string[] };
export type AugmentRow = {
  id: number;
  name: string;
  rarity: "prismatic" | "gold" | "silver";
  pickRate: number;
  /** The game's own build tags, as style names (lib/build-tags.ts). */
  tags: string[];
};
export type { Mate };
export type Change = {
  slot: string;
  name: string;
  ability: string;
  icon?: string;
  rift: number[];
  mayhem: number[];
};
export type BaseStats = {
  hp: number[];
  hp5: number[];
  ad: number[];
  as: number[];
  armor: number[];
  mr: number[];
  range: number;
  ms: number;
  resource?: { kind: string; base: number[]; regen: number[] };
};
export type Style = {
  label: string;
  share: number;
  winRate: number;
  lift: number;
};

export type ChampionPage = {
  winRate: number;
  skills: SkillRow[];
  starting: ItemRow[];
  boots: ItemRow[];
  core: ItemRow[];
  full: ItemRow[];
  items: ItemRow[];
  /** What to buy after the best core: the 4th, 5th and 6th item. */
  late: LateSlot[];
  augments: AugmentRow[];
  mates: Mate[];
  styles: Style[];
  changes: Change[];
  modifiers: Record<string, number>;
  stats: BaseStats | null;
  /** Names and icons of every item the tables show. */
  itemInfo: Record<number, { name: string; icon?: string }>;
};

type ClientChamp = {
  alias: string;
  stats?: BaseStats;
  abilities?: { slot: string; name: string; icon?: string }[];
  mayhem?: { slot: string; name: string; rift: number[]; mayhem: number[] }[];
  builds?: { styles?: { label: string; share: number; win: number }[] };
};

// champions/data.js and modifiers.js are the champion tab's own files: a `window.X = {...};` assignment each.
const loaded = new Map<string, unknown>();
function windowJson<T>(rel: string): T | null {
  if (!loaded.has(rel)) {
    let v: unknown = null;
    if (repoHas(rel)) {
      const text = readFileSync(repoPath(rel), "utf8");
      v = JSON.parse(
        text
          .slice(text.indexOf("=") + 1)
          .trim()
          .replace(/;\s*$/, ""),
      );
    }
    loaded.set(rel, v);
  }
  return loaded.get(rel) as T | null;
}

const RARITIES = ["prismatic", "gold", "silver"] as const;

export function championPage(alias: string): ChampionPage | null {
  const id = IDS[alias];
  if (id === undefined) return null;
  const { live } = liveWithChange();
  const rates = new Map(live.map((c) => [c.name, c.win_rate]));
  const base = rates.get(alias) ?? 0.5;
  const rated = (win: number | undefined, pick: number): Rated => ({
    winRate: win ?? 0,
    pickRate: pick,
    lift: (win ?? 0) - base,
  });

  const b = readRepoJson<Builds>(`data/cn/builds/${id}.json`);
  const rewards = rewardItems();
  const all = items();
  const rows = (list: Raw[] | undefined) =>
    (list ?? [])
      .filter((r) => r.items.every((i) => all.has(i) && !rewards.has(i)))
      .map((r) => ({ items: r.items, ...rated(r.win_rate, r.pick_rate) }));

  const skills = (b?.skills ?? []).map((s) => ({
    max: s.max_order,
    levels: s.orders?.[0]?.order ?? [],
    ...rated(s.win_rate, s.pick_rate),
  }));

  const rarity = new Map<number, AugmentRow["rarity"]>();
  for (const r of RARITIES)
    for (const a of b?.augments?.[r] ?? []) rarity.set(a.id, r);
  const augments = (b?.augments?.all ?? [])
    .filter((a) => AUGS[a.id])
    .map((a) => ({
      id: a.id,
      name: AUGS[a.id],
      tags: officialStyleLabels(a.id),
      rarity: rarity.get(a.id) ?? "silver",
      pickRate: a.pick_rate,
    }));

  // Win rate boost: the Duos list's numbers (lib/duos.ts), the synergy adjusted for how often a pair is played,
  // over the teammates the champion has in at least MIN_PAIR_PICK of its games.
  const mates = matesOf(alias).filter((m) => m.pickRate >= MIN_PAIR_PICK);

  const client = windowJson<{ champions: ClientChamp[] }>(
    "champions/data.js",
  )?.champions.find((c) => c.alias === alias);
  const abilities = new Map((client?.abilities ?? []).map((a) => [a.slot, a]));
  const changes = (client?.mayhem ?? []).map((m) => ({
    ...m,
    ability: abilities.get(m.slot)?.name ?? "",
    icon: abilities.get(m.slot)?.icon,
  }));
  const styles = (client?.builds?.styles ?? []).map((s) => ({
    label: s.label,
    share: s.share,
    ...rated(s.win, s.share),
  }));
  const modifiers =
    windowJson<Record<string, Record<string, number>>>(
      "champions/modifiers.js",
    )?.[alias] ?? {};

  const boots = scoreItems(rows(b?.items?.boots));
  const full = scoreItems(rows(b?.items?.full_builds));
  const single = tiered([
    ...rows(b?.items?.other),
    ...rows(b?.items?.boots),
    ...rows(b?.items?.starting),
  ]);
  const core = withBoots(scoreItems(rows(b?.items?.core)), full, boots[0]);
  const page = {
    winRate: base,
    skills,
    starting: scoreItems(rows(b?.items?.starting)),
    boots,
    core,
    full,
    items: single,
    late: lateSlots(core[0], single),
    augments,
    mates,
    styles,
    changes,
    modifiers,
    stats: client?.stats ?? null,
  };
  const used = new Set(
    [page.starting, page.boots, page.core, page.full, page.items]
      .flat()
      .flatMap((r) => (r.boots ? [r.boots, ...r.items] : r.items)),
  );
  const itemInfo = Object.fromEntries(
    [...used].map((i) => [
      i,
      { name: all.get(i)!.name, icon: all.get(i)!.icon },
    ]),
  );
  return { ...page, itemInfo };
}

const MEDIAN_GAMES = 1000; // pseudo-games for an item of median popularity, as on the Tier List
const PRIOR = 0.25; // the average's weight, in median items' worth of games

/** Every single item the champion builds, grouped by shop tier (Legendary, Boots, Epic...) and best DeepScore first within each tier. */
function tiered(list: ItemRow[]): ItemRow[] {
  const seen = new Set<number>();
  const one = list.filter(
    (r) =>
      r.items.length === 1 && !seen.has(r.items[0]) && seen.add(r.items[0]),
  );
  return ITEM_TIERS.flatMap((tier) =>
    scoreItems(one.filter((r) => itemTier(r.items[0]) === tier)).map((r) => ({
      ...r,
      tier,
    })),
  );
}

/** Each core build with the boots most often bought alongside it in six-item builds, or the best boots overall. */
function withBoots(
  core: ItemRow[],
  full: ItemRow[],
  best: ItemRow | undefined,
): ItemRow[] {
  return core.map((r) => {
    const share = new Map<number, number>();
    for (const f of full) {
      if (!r.items.every((i) => f.items.includes(i))) continue;
      for (const i of f.items)
        if (itemTier(i) === "boots")
          share.set(i, (share.get(i) ?? 0) + f.pickRate);
    }
    const paired = [...share].sort((x, y) => y[1] - x[1])[0]?.[0];
    const boots = paired ?? best?.items[0];
    return boots === undefined ? r : { ...r, boots };
  });
}

const LATE_SLOTS = [4, 5, 6];
const LATE_OPTIONS = 4;

/**
 * The 4th, 5th and 6th item after the best core: the champion's other legendary items, by DeepScore among
 * themselves. Each slot
 * assumes the best pick of the slots before it was bought, so it drops out of the later slots' options.
 */
function lateSlots(core: ItemRow | undefined, single: ItemRow[]): LateSlot[] {
  if (!core) return [];
  const taken = new Set(core.items);
  // Scored against each other: the core items would otherwise crowd every option to the bottom of the scale.
  const pool = scoreItems(
    single.filter((r) => r.tier === "legendary" && !taken.has(r.items[0])),
  );
  const slots: LateSlot[] = [];
  for (const slot of LATE_SLOTS) {
    const options = pool
      .filter((r) => !taken.has(r.items[0]))
      .slice(0, LATE_OPTIONS);
    if (!options.length) break;
    slots.push({ slot, options });
    taken.add(options[0].items[0]);
  }
  return slots;
}

const scoreItems = (list: ItemRow[]): ItemRow[] => scoreRows(list);

/** DeepScore for each row against the rest of the champion's list (items, builds, spell pairs; lib/deepscore.ts), best first. */
export function scoreRows<T extends { winRate: number; pickRate: number }>(list: T[]): (T & { deepScore?: number })[] {
  if (!list.length) return list;
  const picks = list.map((r) => r.pickRate).sort((x, y) => x - y);
  const median = picks[Math.floor(picks.length / 2)] || 1;
  const total = list.reduce((s, r) => s + r.pickRate, 0) || 1;
  const mean = list.reduce((s, r) => s + r.winRate * r.pickRate, 0) / total;
  const bounds = list.map((r) =>
    lowerBound(
      r.winRate,
      (r.pickRate / median) * MEDIAN_GAMES,
      mean,
      PRIOR * MEDIAN_GAMES,
    ),
  );
  const grades = grade(bounds);
  return list
    .map((r, i) => ({ ...r, deepScore: grades[i].deepScore }))
    .sort((x, y) => y.deepScore! - x.deepScore! || y.pickRate - x.pickRate);
}

/** The row players should copy: most wins among rows with a real following (2% of games, or the top three). */
export function bestRow<T extends Rated>(rows: T[], min = 0.02): T | null {
  const common = rows.filter((r, i) => r.pickRate >= min || i < 3);
  return common.length
    ? common.reduce((a, r) => (r.winRate > a.winRate ? r : a))
    : null;
}
