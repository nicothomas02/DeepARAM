import "server-only";
import { readFileSync } from "node:fs";
import championIds from "@/data/champion-ids.json";
import augmentNames from "@/data/augment-names.json";
import { liveWithChange } from "./champions";
import { FIT, type Fit } from "./deepscore";
import { clashWith, withoutClashes } from "./item-limits";
import { alongCore, bestRow, buildOrder, followed, laterItems, MIN_FOLLOWING, scoreRows, sameStyle, situational, skipsBoots, slotItems, fullPicks, realFullPicks, type ItemRow, type Rated, type SlotCounts } from "./card-score";

export { bestRow, buildOrder, scoreRows, type ItemRow, type Rated };
import { SIMULATOR_IN_STATS } from "./sim-policy";
import type { Situation } from "./situations";
import { augmentSwaps, buyingOrder, restOfBuild, rushParts, startFirst, starterFits, styleCores, upgradeSwaps, type AugmentSwap } from "./build-plan";
import { orderedCores } from "./champion-history";
import {
  ITEM_TIERS,
  itemClasses,
  itemParts,
  itemRecipe,
  itemRoles,
  itemSituation,
  itemTier,
  ranked,
  items,
  rewardItems,
} from "./items";
import { repoHas, repoPath, readRepoJson } from "./repo-data";
import { matesOf, type Mate } from "./duos";
import { officialStyleLabels } from "./build-tags";
import { skillOrders } from "./skill-orders";

// The ranked tables on a champion page (/champions/<Alias>): skill orders, item paths, augments,
// teammates, Mayhem's ability changes and base stats. Every row with a win rate also carries its
// "win lift", the row's win rate minus the champion's own, so a build that beats the champion's
// average stands out. Data: data/cn/builds/<id>.json (builds), the Duos list (teammates, lib/duos.ts) and
// champions/data.js (ability changes, base stats, build styles).

const IDS = championIds as Record<string, number>;
const AUGS = augmentNames as Record<string, string>;

/** A pair only counts as a teammate once it shows up in at least this share of games. */
export const MIN_PAIR_PICK = 0.008;

/** games: real games behind the row when the source has them (AramHex rows, data/aramhex/merge.py). */
type Raw = { items: number[]; pick_rate: number; win_rate?: number; games?: number; pooled?: { win_rate: number; games: number; patches: number } };
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
    { id: number; pick_rate: number; grade?: string; win_rate?: number; games?: number; pooled?: { win_rate: number; games: number; patches: number } }[]
  >;
  /** Blocks that stopped updating (data/cn/builds.py), and ones rebuilt from the six-item builds. */
  stale?: string[];
  derived?: string[];
};


/** Per champion id: core build ("id,id,id") -> boots id -> core items bought before the boots. */
/** Tear items: they turn into Muramana / Seraph's Embrace, which the feed's six-item builds never list. */
const TEAR_ITEMS = new Set([3003, 3004]);
const TEAR_CORE_SHARE = 0.3;
/** An earlier core still holds when each of its items is in at least this share of today's six-item builds. */
const EARLIER_CORE_SUPPORT = 0.5;
/** A starter can lead the card with MIN_FOLLOWING of the most common start's pick rate, or this many real games:
 *  starts with real game counts are shrunk by their own noise, and a rare start's lead held up on the next patch as
 *  well as a common one's (101 history 16.20-16.23). Nico, 2026-11-21: allow overlooked starters (Guardian's Blade on Zeri). */
const START_MIN_GAMES = 2000;

/** One build style on the card: its own core, start, later and situational items, and its augments (estimated). */
export type BuildOption = {
  style: string;
  /** Share of the champion's games. */
  share: number;
  games: number;
  winRate: number;
  deepScore: number;
  /** The card's own best build (the one the rest of the page shows) rather than the style's summary. */
  main: boolean;
  core: ItemRow;
  start: ItemRow | null;
  situational: SituationRow[];
  /** Items to swap in once you take certain augments (lib/build-plan.ts augmentSwaps). */
  augmentSwaps: AugmentSwap[];
  rush: number[];
  /** Augments whose official build tags fit the style (or have none), most picked first: estimated. */
  augments: number[];
  /** The style's own skill orders (lib/skill-orders.ts) when it has enough players, else the champion's. */
  skills: SkillRow[];
};
type Archetype = {
  style: string;
  share: number;
  games: number;
  win_rate: number;
  starters?: number[];
  core?: number[];
  boots?: number[];
  later?: number[];
  augments?: Record<string, number[]>;
};

type BootsTiming = { champions: Record<string, Record<string, Record<string, number>>> };
/** data/estimates/boots_slot.json: per champion [core items bought before the boots or null, boots buyers]. */
type BootsSlots = { champions: Record<string, [number | null, number]>; all: number };
/** The options for one item slot after the core (4th, 5th, 6th), best DeepScore first. */
/** A situation the champion's items answer, with its best items (lib/card-score.ts situational). */
export type SituationRow = { situation: Situation; options: ItemRow[] };
export type SkillRow = Rated & { max: string[]; levels: string[] };
export type AugmentRow = {
  id: number;
  name: string;
  rarity: "prismatic" | "gold" | "silver";
  pickRate: number;
  /** The feed's letter grade for this augment on this champion (S, A, B, C), when it has one. */
  grade?: string;
  /** Real win rate and games with the augment on this champion, when the data has them (AramHex). Never shown
   *  raw on the site (augment win rates stay hidden, PR #551); they feed DeepScore. */
  winRate?: number;
  games?: number;
  /** The same with earlier patches pooled in where nothing changed (data/aramhex/common.py pool): win rate, the
   *  games its precision is worth, and how many patches it spans. DeepScore ranks on this by default. */
  pooled?: { winRate: number; games: number; patches: number };
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
  games?: number;
};

export type ChampionPage = {
  winRate: number;
  skills: SkillRow[];
  starting: ItemRow[];
  /** The starter the top card shows: the best that builds into the best core, else none. */
  cardStart: ItemRow | null;
  /** Empty when the champion skips boots (lib/card-score.ts skipsBoots). */
  boots: ItemRow[];
  core: ItemRow[];
  full: ItemRow[];
  items: ItemRow[];
  /** Items to swap in after the core, by situation (vs healing, vs burst...). */
  situational: SituationRow[];
  /** One entry per real build style when the champion has two (lib/build-plan.ts styleCores), else empty. */
  buildStyles: { style: string; core: ItemRow; situational: SituationRow[]; rush: number[] }[];
  /**
   * The champion's builds by style when it has two or more (crit and AP Ashe; data/estimates/build_archetypes.json),
   * best DeepScore first, else empty. The card switches everything it can between them (Nico, 2026-11-21).
   */
  builds: BuildOption[];
  /** Components to rush for the best core's first item. */
  rush: number[];
  /** Augments the champion takes that upgrade one of its items: with it, buy that item first. */
  swaps: { augment: number; item: number }[];
  /** Items to swap in once you take certain augments (Upgrade augments, build-changing ones), for the main core. */
  augmentSwaps: AugmentSwap[];
  augments: AugmentRow[];
  mates: Mate[];
  styles: Style[];
  changes: Change[];
  modifiers: Record<string, number>;
  stats: BaseStats | null;
  /** Always false since skill orders come from real level-ups (lib/skill-orders.ts); kept for the page's note. */
  skillsStale: boolean;
  /** The core rows come from the feed's last own cores (tear builds the six-item builds can't show). */
  coreFromEarlier: boolean;
  /** Core builds come from the six-item builds, so their order is estimated. */
  coreDerived: boolean;
  /**
   * Too few games so far in the builds' window: core, full builds and single items blend in the previous
   * window's builds, moved for the patch's changes (data/estimates/early_builds.json).
   */
  buildsEstimated: boolean;
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
export function windowJson<T>(rel: string): T | null {
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
  const champGames = live.find((c) => c.name === alias)?.sample;
  const rated = (win: number | undefined, pick: number): Rated => ({
    winRate: win ?? 0,
    pickRate: pick,
    lift: (win ?? 0) - base,
    ...(champGames ? { games: champGames * pick } : {}),
  });

  const raw = readRepoJson<Builds>(`data/cn/builds/${id}.json`);
  const early = earlyBuilds(id);
  // The early-window blend (101's builds right after its window restarts) only stands in for 101 lists: where AramHex
  // supplies a list (sources["items.core"] / ["items.other"]), its real patch counts stay (2026-11-23: the blend was
  // replacing Rek'Sai's AramHex single items).
  const src = (raw as { sources?: Record<string, string> } | null)?.sources ?? {};
  const keep = early
    ? Object.fromEntries(Object.entries(early).filter(([k]) => src[`items.${k}`] !== "aramhex"))
    : null;
  const b: Builds | null = raw && keep ? { ...raw, items: { ...raw.items, ...keep } } : raw;
  const rewards = rewardItems();
  const all = items();
  const rows = (list: Raw[] | undefined) =>
    (list ?? [])
      .filter((r) => r.items.every((i) => all.has(i) && !rewards.has(i)))
      .map((r) => ({
        items: r.items,
        ...rated(r.win_rate, r.pick_rate),
        ...(r.games ? { games: r.games } : {}),
        ...(r.pooled ? { pooled: { winRate: r.pooled.win_rate, games: r.pooled.games, patches: r.pooled.patches } } : {}),
      }));

  // Skill orders from real level-ups, best DeepScore first (lib/skill-orders.ts; Nico 2026-11-24). The feed's list is
  // the same generic one for every champion, so it isn't used.
  const lobbySkills = skillOrders(id);
  const skills: SkillRow[] = lobbySkills?.all ?? [];
  const skillsFor = (style: string): SkillRow[] => lobbySkills?.styles[style] ?? skills;

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
      grade: a.grade,
      ...(a.games && a.win_rate !== undefined ? { winRate: a.win_rate, games: a.games } : {}),
      ...(a.pooled ? { pooled: { winRate: a.pooled.win_rate, games: a.pooled.games, patches: a.pooled.patches } } : {}),
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

  const boots = scoreItems(rows(b?.items?.boots), FIT.items);
  const full = scoreItems(rows(b?.items?.full_builds));
  const single = tiered([
    ...rows(b?.items?.other),
    ...rows(b?.items?.boots),
    ...rows(b?.items?.starting),
  ]);
  const timing =
    (SIMULATOR_IN_STATS ? readRepoJson<BootsTiming>("data/estimates/boots_timing.json")?.champions[String(id)] : undefined) ?? {};
  // When players buy boots (Nico, 2026-11-20: boots in their real slot), from the purchase timelines of the owner's
  // archived games, all ten players (data/estimates/boots_slot.json): the slot most of the champion's players use. No
  // "another slot wins more" moves (2026-11-23): ~50 buyers per champion make those mostly chance. Too few buyers
  // (under 20): the slot most players use overall.
  const slots = readRepoJson<BootsSlots>("data/estimates/boots_slot.json");
  const playedSlot = slots ? (slots.champions[String(id)]?.[0] ?? slots.all) : undefined;
  const bootsRows = rows(b?.items?.boots);
  const noBoots = skipsBoots(bootsRows, full, (i) => itemTier(i) === "boots");
  // Tear builds (Manamune, Archangel's Staff) end the game as Muramana and Seraph's Embrace, which the feed's six-item
  // builds never list, so a core rebuilt from them can't show those builds. Found comparing with another stats site
  // (2026-11-21): Ezreal, Kassadin, Veigar and others lost their most played build. For a champion whose last cores
  // from the feed itself were mostly tear builds, the card keeps those cores (labeled from earlier games).
  const orderRows = orderedCores(id);
  const tearShare = (() => {
    const all = orderRows.reduce((t, r) => t + r.weight, 0);
    const tear = orderRows.filter((r) => r.items.some((i) => TEAR_ITEMS.has(i % 10000))).reduce((t, r) => t + r.weight, 0);
    return all ? tear / all : 0;
  })();
  // Cores rebuilt from six-item builds take the three items most often finished, which favours late items (Lord
  // Dominik's) over the one bought first (Yunara's Yun Tal, Nico 2026-11-21). So an earlier core from the feed itself, in
  // buying order, stays when today's six-item builds still back every one of its items.
  const fullWeight = full.reduce((t, r) => t + r.pickRate, 0);
  const inFull = (i: number) =>
    TEAR_ITEMS.has(i % 10000) ? 1 : (fullWeight ? full.filter((r) => r.items.includes(i)).reduce((t, r) => t + r.pickRate, 0) / fullWeight : 0);
  const supported = (items: number[]) => items.every((i) => inFull(i) >= EARLIER_CORE_SUPPORT);
  const derivedCore = !early && !!b?.derived?.includes("items.core");
  const earlierCores = () => {
    const m = new Map<string, { items: number[]; pick: number; wins: number }>();
    for (const r of orderRows) {
      const k = [...r.items].sort((x, y) => x - y).join(",");
      const e = m.get(k) ?? { items: [...r.items].sort((x, y) => x - y), pick: 0, wins: 0 };
      e.pick += r.weight;
      e.wins += r.weight * (r.win ?? 0.5);
      m.set(k, e);
    }
    return [...m.values()].map((e) => ({ items: e.items, ...rated(e.wins / e.pick, e.pick) })).filter((r) => r.items.every((i) => all.has(i)));
  };
  const earlierTop = derivedCore ? [...earlierCores()].sort((x, y) => y.pickRate - x.pickRate)[0] : undefined;
  const coreFromEarlier =
    derivedCore && (tearShare >= TEAR_CORE_SHARE || (!!earlierTop && supported(earlierTop.items)));
  const scoredCore = followed(
    // Ranked by their own numbers from those games: today's six-item builds can't say which items came first.
    // Never a core the game won't let you own (Archangel's with Manamune: one Tear item, lib/item-limits.ts).
    scoreItems((coreFromEarlier ? earlierCores().filter((r) => tearShare >= TEAR_CORE_SHARE || supported(r.items)) : rows(b?.items?.core)).filter(
      (r) => withoutClashes(r.items).length === r.items.length,
    )),
  );
  const withBootsCore = noBoots ? scoredCore : withBoots(scoredCore, full, boots, timing, playedSlot ?? undefined);
  // Items in the order players buy them (Nico, 2026-11-20): the feed's cores listed in buying order (lib/build-plan.ts
  // buyingOrder), on top of the starting items: a core opens with the item its starter builds into (Cloak + Tome:
  // Rite of Ruin), and a starter's parts build into the first item or the boots, or are standalone starters (Tear,
  // Guardian's Blade). A finished item can't be afforded at the start, so a row holding one is noise.
  const startRows = scoreItems(rows(b?.items?.starting), FIT.items);
  const affordable = startRows.filter((r) => !r.items.some((i) => itemTier(i) === "legendary"));
  // A starter needs a real following to lead (same 1/4 rule as builds, Nico 2026-11-21) or enough games of its own
  // (START_MIN_GAMES), so a start bought in a handful of games can't lead on luck.
  const startPool = affordable.length ? affordable : startRows;
  const startTop = Math.max(0, ...startPool.map((r) => r.pickRate));
  const startFollowed = (r: ItemRow) => r.pickRate >= MIN_FOLLOWING * startTop || (r.games ?? 0) >= START_MIN_GAMES;
  const scoredStart = [...startPool.filter(startFollowed), ...startPool.filter((r) => !startFollowed(r))];
  const standalone = (i: number) => ["starter", "consumable"].includes(itemTier(i));
  const withBootsOf = (c: ItemRow, its: number[]) => [...its, ...(c.boots !== undefined ? [c.boots] : [])];
  // A start fits when its parts go into the core, its boots or the rest of the usual build (Long Sword + Guardian's
  // Blade on Zeri: the Long Sword goes into Lord Dominik's after the core).
  const fits = (c: ItemRow) => (r: ItemRow) =>
    starterFits(r.items, withBootsOf(c, [...c.items, ...(c.rest ?? restOfBuild(c.items, c.boots, full, isBoots))]), itemParts, standalone);
  const fitsFirst = (c: ItemRow) => (r: ItemRow) => starterFits(r.items, withBootsOf(c, c.items.slice(0, 1)), itemParts, standalone);
  const isBoots = (i: number) => itemTier(i) === "boots";
  // The items after the core, one by one, and split by the slot players buy them in (data/estimates/item_slots.json,
  // purchase order from the owner's archived games, all ten players: the feeds list six-item builds as sets).
  const itemSlots = readRepoJson<{ all: SlotCounts; champions: Record<string, SlotCounts> }>("data/estimates/item_slots.json");
  const withLater = (row: ItemRow): ItemRow => {
    const pool = afterCore(row, single, full);
    const bySlot = slotItems(pool, row, itemClasses, itemSlots?.champions[String(id)], itemSlots?.all);
    const later = laterItems(pool, row, itemClasses);
    const picks = realFullPicks(row, full, single, bySlot ?? undefined, isBoots) ?? fullPicks(row, bySlot ?? undefined, later);
    // Never two items of one game limit group (lib/item-limits.ts), against the core or an earlier pick.
    const kept = withoutClashes(picks.map((r) => r.items[0]), buildOrder(row));
    return { ...row, later, ...(bySlot ? { slots: bySlot } : {}), full: picks.filter((r) => kept.includes(r.items[0])) };
  };
  // Augment-triggered swaps for a core (lib/build-plan.ts augmentSwaps): rule-based tips, labelled as such.
  const legendaryPool = single.filter((r) => r.tier === "legendary");
  const swapsFor = (c: ItemRow | undefined): AugmentSwap[] =>
    c
      ? augmentSwaps(
          augments,
          [...buildOrder(c), ...(c.full ?? []).map((r) => r.items[0])],
          legendaryPool,
          itemRoles,
          (i) => all.get(i)?.name,
          [...c.items, ...followed(sameStyle(legendaryPool, c.items, itemClasses)).map((r) => r.items[0])].filter((i, k, a) => a.indexOf(i) === k),
        )
      : [];
  const core = withBootsCore.map((c) => {
    const st = scoredStart.find((r) => startFollowed(r) && fits(c)(r)) ?? scoredStart.find(fits(c));
    const { items } = buyingOrder(st ? startFirst(c.items, st.items, itemParts, standalone) : c.items, orderRows);
    const row: ItemRow = { ...c, items, rest: restOfBuild(items, c.boots, full, isBoots) };
    return withLater(row);
  });
  const startingRows = core[0]
    ? [startFollowed, () => true]
        .flatMap((tier) => [fitsFirst(core[0]), fits(core[0]), () => true].map((ok) => (r: ItemRow) => tier(r) && ok(r)))
        .reduce<ItemRow[]>((out, ok) => [...out, ...scoredStart.filter((r) => ok(r) && !out.includes(r))], [])
    : scoredStart;
  const starting = startingRows;
  const page0Start = (core[0] ? starting.find(fits(core[0])) : starting[0]) ?? null;
  // Builds by style (Nico, 2026-11-21: crit vs AP Ashe, everything on the card follows the build). The card's own
  // best core stands for the style it belongs to; the other styles take their summary from build_archetypes.json.
  const base10k = (i: number) => i % 10000;
  const archetypes = readRepoJson<{ champions: Record<string, Archetype[]> }>("data/estimates/build_archetypes.json")?.champions[String(id)] ?? [];
  const known = (i: number) => (all.has(i) ? i : ([...all.keys()].find((k) => base10k(k) === base10k(i)) ?? i));
  const overlap = (a: number[], b: number[]) => a.filter((i) => b.some((j) => base10k(j) === base10k(i))).length;
  const mainArch = core[0] && archetypes.length > 1
    ? archetypes.reduce((best, a) => (overlap(a.core ?? [], core[0].items) > overlap(best.core ?? [], core[0].items) ? a : best))
    : null;
  // Each style's DeepScore is its build's, scored together with the champion's cores: the card's own core with its
  // games, the other styles with all of their style's games.
  const archScores = (() => {
    const others = archetypes.filter((a) => a !== mainArch).map((a) => ({ style: a.style, items: [] as number[], winRate: a.win_rate, pickRate: a.share, lift: a.win_rate - base, games: a.games }));
    const scored = scoreRows([...core.map((c) => ({ ...c, style: "" })), ...others]);
    const mainScore = scored.find((r) => r.style === "" && r.items === core[0]?.items)?.deepScore;
    return archetypes
      .map((a) => ({ style: a.style, deepScore: a === mainArch ? mainScore : scored.find((r) => r.style === a.style)?.deepScore }))
      .sort((x, y) => (y.deepScore ?? 0) - (x.deepScore ?? 0));
  })();
  const builds: BuildOption[] = !mainArch
    ? []
    : archScores
        .map((sc) => {
          const a = archetypes.find((x) => x.style === sc.style)!;
          const augs = Object.values(a.augments ?? {}).flat();
          if (a === mainArch)
            return { style: a.style, share: a.share, games: a.games, winRate: a.win_rate, deepScore: sc.deepScore ?? 50, main: true,
              core: core[0], start: page0Start, situational: situationalItems(core[0], single, full), augmentSwaps: swapsFor(core[0]), rush: rushParts(core[0].items[0], itemRecipe), augments: augs, skills: skillsFor(a.style) };
          const coreIds = (a.core ?? []).map(known);
          // A style whose core already holds boots (Bel'Veth: Gluttonous Greaves) gets no second pair.
          const coreHasBoots = coreIds.some((i) => itemTier(i) === "boots");
          const bootsId = noBoots || coreHasBoots ? undefined : a.boots?.[0] !== undefined ? known(a.boots[0]) : undefined;
          const row: ItemRow = { items: coreIds, ...rated(a.win_rate, a.share), boots: bootsId, bootsAt: bootsId !== undefined ? (playedSlot ?? undefined) : undefined };
          const st = scoredStart.find((r) => startFollowed(r) && fits(row)(r)) ?? scoredStart.find(fits(row)) ?? null;
          const ordered = buyingOrder(st ? startFirst(coreIds, st.items, itemParts, standalone) : coreIds, orderRows).items;
          const c0: ItemRow = { ...row, items: ordered, rest: withoutClashes((a.later ?? []).map(known).filter((i) => !ordered.includes(i)), ordered).slice(0, 3) };
          const c: ItemRow = withLater(c0);
          // The style's own starters only when they fit its build: the estimate falls back to the champion's most picked
          // starter of any style (crit Miss Fortune got Fated Ashes + Tear; champion review 2026-11-24, G4).
          const own: ItemRow | null = a.starters?.length ? { items: a.starters.map(known), winRate: NaN, pickRate: 0, lift: 0 } : null;
          const start = st ?? (own && fits(row)(own) ? own : null);
          return { style: a.style, share: a.share, games: a.games, winRate: a.win_rate, deepScore: sc.deepScore ?? 50, main: false,
            core: c, start, situational: situationalItems(c, single, full), augmentSwaps: swapsFor(c), rush: rushParts(c.items[0], itemRecipe), augments: augs, skills: skillsFor(a.style) };
        });
  const page = {
    builds,
    winRate: base,
    skills,
    starting,
    // The card shows a starter only when one fits its core; the full list below keeps every row.
    cardStart: page0Start,
    boots: noBoots ? [] : boots,
    core,
    full,
    items: noBoots ? single.filter((r) => r.tier !== "boots") : single,
    situational: situationalItems(core[0], single, full),
    // A tab per real build style (tank and AP Alistar), each with its own situational items.
    buildStyles: styleCores(core, itemClasses).map((s) => ({ ...s, situational: situationalItems(s.core, single, full), rush: rushParts(s.core.items[0], itemRecipe) })),
    rush: core[0] ? rushParts(core[0].items[0], itemRecipe) : [],
    swaps: upgradeSwaps(
      [...augments].sort((x, y) => y.pickRate - x.pickRate),
      [...(core[0]?.items ?? []), ...(core[0] ? sameStyle(single.filter((r) => r.tier === "legendary"), core[0].items, itemClasses) : []).map((r) => r.items[0])]
        .filter((i, k, a) => a.indexOf(i) === k)
        .flatMap((i) => (all.get(i) ? [{ id: i, name: all.get(i)!.name }] : [])),
    ),
    augmentSwaps: swapsFor(core[0]),
    augments,
    mates,
    styles,
    changes,
    modifiers,
    stats: client?.stats ?? null,
    skillsStale: false,
    coreFromEarlier,
    coreDerived: !early && !!b?.derived?.includes("items.core"),
    buildsEstimated: !!early,
  };
  const used = new Set(
    [page.starting, page.boots, page.core, page.full, page.items]
      .flat()
      .flatMap((r) => (r.boots ? [r.boots, ...r.items] : r.items))
      .concat(page.rush, page.swaps.map((s) => s.item), page.buildStyles.flatMap((s) => s.rush), page.core.flatMap((c) => c.rest ?? []))
      .concat(page.builds.flatMap((b) => [...b.core.items, ...(b.core.boots !== undefined ? [b.core.boots] : []), ...(b.core.rest ?? []), ...(b.start?.items ?? []), ...b.rush, ...b.situational.flatMap((s) => s.options.flatMap((o) => o.items))]))
      .filter((i) => all.has(i)),
  );
  const itemInfo = Object.fromEntries(
    [...used].map((i) => [
      i,
      { name: all.get(i)!.name, icon: all.get(i)!.icon },
    ]),
  );
  return { ...page, itemInfo };
}

type EarlyBuilds = {
  champions?: Record<string, { estimated: boolean; full_builds: Raw[]; core: Raw[]; other: Raw[] }>;
};

/** The champion's estimated core, full builds and single items while its builds have too few games, else null. */
function earlyBuilds(id: number): Pick<Required<Builds>["items"], "core" | "full_builds" | "other"> | null {
  const c = readRepoJson<EarlyBuilds>("data/estimates/early_builds.json")?.champions?.[String(id)];
  if (!c?.estimated || !c.full_builds.length) return null;
  return { core: c.core, full_builds: c.full_builds, other: c.other };
}


/** Every single item the champion builds, grouped by shop tier (Legendary, Boots, Epic...) and best DeepScore first within each tier. */
function tiered(list: ItemRow[]): ItemRow[] {
  const seen = new Set<number>();
  const one = list.filter(
    (r) =>
      r.items.length === 1 && !seen.has(r.items[0]) && seen.add(r.items[0]),
  );
  // Components and items that transform are listed after the scored ones, by pick rate, without a DeepScore (lib/items.ts ranked).
  return ITEM_TIERS.flatMap((tier) => {
    const inTier = one.filter((r) => itemTier(r.items[0]) === tier);
    const unscored = inTier.filter((r) => !ranked(r.items[0])).sort((x, y) => y.pickRate - x.pickRate);
    return [...scoreSingles(inTier.filter((r) => ranked(r.items[0]))), ...unscored].map((r) => ({ ...r, tier }));
  });
}

/**
 * Each core build with its boots: among the boots bought alongside it in six-item builds with a real following
 * (MIN_FOLLOWING of the most common pairing), the one with the best DeepScore on the boots list, so the most popular
 * pairing doesn't win on popularity alone (Nico, 2026-11-21: Zeri's card showed Berserker's Greaves over the higher
 * scoring Gluttonous Greaves); the best boots overall when no six-item build has the core. Then
 * when to buy them: the simulated step for that core, else the step the champion's other cores use most with those boots.
 */
function withBoots(
  core: ItemRow[],
  full: ItemRow[],
  scored: ItemRow[],
  timing: BootsTiming["champions"][string],
  played?: number,
): ItemRow[] {
  const usual = (boots: number) => {
    const n = new Map<number, number>();
    for (const t of Object.values(timing)) {
      const at = t[String(boots)];
      if (at !== undefined) n.set(at, (n.get(at) ?? 0) + 1);
    }
    return [...n].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0]?.[0];
  };
  return core.map((r) => {
    const share = new Map<number, number>();
    for (const f of full) {
      if (!r.items.every((i) => f.items.includes(i))) continue;
      for (const i of f.items)
        if (itemTier(i) === "boots")
          share.set(i, (share.get(i) ?? 0) + f.pickRate);
    }
    const top = Math.max(0, ...share.values());
    const score = (i: number) => scored.find((b) => b.items[0] === i)?.deepScore ?? -1;
    const paired = [...share]
      .filter(([, s]) => s >= MIN_FOLLOWING * top)
      .sort((x, y) => score(y[0]) - score(x[0]) || y[1] - x[1])[0]?.[0];
    const boots = paired ?? scored[0]?.items[0];
    if (boots === undefined) return r;
    const bootsAt = played ?? timing[r.items.join(",")]?.[String(boots)] ?? usual(boots);
    return bootsAt === undefined ? { ...r, boots } : { ...r, boots, bootsAt };
  });
}

/** The legendary items to pick from after this core: scored against each other (the core items would otherwise
 *  crowd every option to the bottom of the scale), items bought with this core first (lib/card-score.ts alongCore). */
function afterCore(core: ItemRow, single: ItemRow[], full: ItemRow[], keepClashes = false): ItemRow[] {
  // Never an item the game won't let you own with a core item (Lord Dominik's after Mortal Reminder, Nico
  // 2026-11-23); situational lists keep them, as a swap for the item they clash with.
  return alongCore(
    scoreSingles(single.filter((r) => r.tier === "legendary" && ranked(r.items[0]) && !core.items.includes(r.items[0]) && (keepClashes || clashWith(r.items[0], core.items) === undefined))),
    core.items,
    full,
  );
}

/** Situational items after a core: one row per situation with its best items (lib/situations.ts), the swaps
 *  players make most often first (by the best option's pick rate). */
function situationalItems(core: ItemRow | undefined, single: ItemRow[], full: ItemRow[]): SituationRow[] {
  if (!core) return [];
  return situational(sameStyle(afterCore(core, single, full, true), core.items, itemClasses), itemSituation).sort(
    (x, y) => y.options[0].pickRate - x.options[0].pickRate,
  );
}

// Starting items and boots use the fitted settings, which were backtested on them; builds and single items keep
// the old prior until their history can be backtested (data/analysis/predictive.py).
const scoreItems = (list: ItemRow[], fit: Fit | null = null): ItemRow[] => scoreRows(list, fit);
/** Single items: the Tier List's bound rule (Nico 2026-11-23, lib/card-score.ts scoreRows). */
const scoreSingles = (list: ItemRow[]): ItemRow[] => scoreRows(list, FIT.items, { bound: true });


