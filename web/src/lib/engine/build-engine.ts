// The one build engine (Nico 2026-11-23: "build ONE shared build engine ... so they can't drift"): augment ranking,
// reroll advice, the full item path, situational and augment swaps, and the re-plan when a taken augment changes the
// build. Used by the public desktop app (apps/desktop/ui/engine.js, bundled by scripts/build-engine.mjs), Nico's PC
// app (same bundle, served at /engine/build-engine.js) and the site. Pure: no DOM, no storage, no fetch. Inputs are
// the site's public data files (augment-picks.json, overlay.json, damage-types.json, team-fit.json) plus what the
// app reads from the game.
//
// Ported from the PC companion 1.22.0 (DeepARAM-PC 30735d3), then:
// - item limits (game data) and role substitutes (public builds + archive): a path never holds two items of one limit
//   group, and a swap replaces the item it clashes with or substitutes for;
// - augments already shown can't come back that game (League Wiki, ARAM: Mayhem): reroll odds and combo potential
//   leave them out; each card can be rerolled once, so cards already rerolled are never named again;
// - counters that passed the mechanism test (research/counter-items) are real swaps; other lit situational items stay
//   pointers;
// - Weapon of Destiny: the champion's best Weapon item (AramHex real games) goes first.
//
// Every rule carries where it comes from (RULES below). Nico 2026-11-23: no rule ships on an assumption without data
// or his approval. His call the same day ("apply defaults, then test", aramhex/assumptions-audit-2026-11-23.md):
// rules with no evidence are off and come back only when a test passes; design choices (reroll threshold, which slot a
// swap replaces, shop convenience tips) stay as they are until he picks.

export const ENGINE_VERSION = "1.1.0";

// ---------------------------------------------------------------------------------------------------------------
// Rules and where they come from

export type RuleSource = "data" | "game data" | "kit rule" | "inherited" | "assumption";
export type Rule = { source: RuleSource; on: boolean; why: string };
export const RULES: Record<string, Rule> = {
  // Backed by data or the game's own rules: on.
  itemLimits: { source: "game data", on: true, why: "The game's own-only-one groups; never broken in 1,730 public full builds or 1,245 archived games (Immolate and Hydras excepted)." },
  substitutes: { source: "data", on: true, why: "Pairs rarely built together in 101's full builds, confirmed in the archive (data/item-substitutes.json)." },
  seenAugments: { source: "game data", on: true, why: "Wiki: an augment shown once is never offered again that game." },
  rerollOnce: { source: "game data", on: true, why: "Wiki: each card can be rerolled once." },
  provenCounters: { source: "data", on: true, why: "Mechanism tests: MR items, Kaenic, Spirit Visage, Mercury's vs magic-heavy teams (the effect is clearly larger from 60-65% magic up, so 65% holds); armor vs 2+ marksmen." },
  augmentItems: { source: "data", on: true, why: "Augment -> item patterns measured by build share: Draw Your Sword -> Death's Dance, Armored Impact -> Thornmail (+35 pts), Protein Shake -> Locket (+20 pts)." },
  measuredReplan: { source: "data", on: true, why: "Ethereal Weapon switches to the champion's own on-hit build (+25.9 pts on-hit build share). Only measured switches." },
  destinyFirst: { source: "data", on: true, why: "AramHex: the champion's best Weapon of Destiny item, made the first legendary." },
  upgradeLabel: { source: "game data", on: true, why: "An 'Upgrade X' augment upgrades X: said on X's line, the order doesn't change." },
  hasteMath: { source: "game data", on: true, why: "Cooldowns shorten by haste / (100 + haste): a note, not advice." },
  ownedOffPath: { source: "game data", on: true, why: "A finished item you bought that isn't in the path takes the first open later slot, so the path shows what you own." },
  // Design choices Nico hasn't picked yet: kept as they were.
  rerollMinGain: { source: "assumption", on: true, why: "Reroll advice needs +0.25 DeepScore points of expected gain. Picked, not measured: Nico decides." },
  swapLastSlot: { source: "assumption", on: true, why: "A swap that clashes or substitutes with nothing replaces the last open slot. Display rule: Nico decides." },
  shopTips: { source: "assumption", on: true, why: "Sell tip at 6 full slots; buy-now names the priciest affordable part. Convenience rules: Nico decides." },
  // No evidence either way: off until a test passes (Nico 2026-11-23, apply defaults).
  upgradeNext: { source: "assumption", on: false, why: "'Upgrade X' means buy X next. Off until tested." },
  augmentReplan: { source: "assumption", on: false, why: "Other augments switch the build style (style tags, the other 3-vote build changers, the class-wide fallback build). Off until measured like Draw Your Sword -> Death's Dance." },
  countTriggers: { source: "assumption", on: false, why: "'2+ enemies' counts (tanks, burst, crit, healers, enchanters), 3+ Catcher/Vanguard, physical or mixed damage lean. Tested: no effect in the counter tests; stays off." },
  stackingFirst: { source: "assumption", on: false, why: "Stacking items first while no legendary is finished. Tested: +1.2 ± 1.7 pts, not shown; stays off." },
  attackSpeedNudge: { source: "assumption", on: false, why: "Attack-speed items move back from 4.5 attack speed. Off: 451 archive frames show attack speed above 5.0 (up to 11.7)." },
  selfHealWeight: { source: "assumption", on: false, why: "Count self-healers more for Vs healing. Off until tested." },
  wikiModifiers: { source: "assumption", on: false, why: "Weight enemies by the wiki's Mayhem healing/shielding modifiers. Off until tested." },
  itemDamageMix: { source: "assumption", on: false, why: "Enemy damage lean pulled toward their AP/AD items. Off until tested: the lean is the champions' own." },
  resistAugmentSwaps: { source: "assumption", on: false, why: "Fortified/Mystic Guard/Steadfaster push resist swaps first. Off: no data yet." },
  // Removed: % penetration when 2+ enemies stack the resist failed its test (the gain is smaller when they stack).
};

// ---------------------------------------------------------------------------------------------------------------
// Data shapes (the site's public files)

export type Named = { name: string; icon: string | null; deepScore?: number | null };
export type Situational = Named & { when?: string; why?: string; augments?: number[]; replaces?: Named };
export type OverlayChamp = {
  id: string;
  name?: string;
  skills?: string[];
  items?: Named[];
  rest?: Named[];
  full?: Named[];
  later?: Named[];
  laterSlots?: { slot: number; items: Named[] }[];
  situational?: Situational[];
  swaps?: { augment: Named; item: Named }[];
  destiny?: Named | null;
};
/** augment-picks.json */
export type Picks = {
  augments: Record<string, [string, string]>;
  champions: Record<string, [number, number, number?, number?][]>;
  pairs: Record<string, [number, number, number][]>;
  styles: Record<string, string[]>;
  builds?: Record<string, [string, number, number[], number[], number[]][]>;
};
/** damage-types.json */
export type Kinds = {
  champions: Record<string, number>;
  items: Record<string, string[]>;
  boots: number[];
  recipes: Record<string, [string, number, number[]]>;
  limits?: number[][];
  substitutes?: number[][];
};
/** team-fit.json */
export type Fit = { champions: Record<string, [number, string[]]> };
export type Enemy = { champ: string; items: number[] };
export type GameState = {
  champ: string;
  /** Item ids as the game reports them. */
  items: number[];
  enemies?: Enemy[];
  level?: number;
  /** Skill points in Q, W, E, R. */
  skills?: number[];
  gold?: number;
  dead?: boolean;
  /** Seconds since the game started. */
  t?: number;
  /** [ad, attack speed, ability haste], when the app reads them. */
  stats?: number[];
};

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

/** The champion's key in a data file, whatever its capitals (the game says "FiddleSticks"). */
export const keyIn = (obj: object | undefined | null, champ: string | undefined) =>
  obj && champ ? Object.keys(obj).find((k) => k.toLowerCase() === champ.toLowerCase()) : undefined;
// The Collector's icon is 667666 while the game reports 6676.
const ICON_ID: Record<number, number> = { 667666: 6676 };
/** The base item id of an item icon (Mayhem copies 223031 -> 3031). */
export const itemId = (icon: string | null | undefined) => {
  const n = Number((String(icon ?? "").match(/(\d+)\.png$/) ?? [])[1]);
  return ICON_ID[n] ?? n % 10000;
};
const base = (id: number) => id % 10000;
const champKey = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

// ---------------------------------------------------------------------------------------------------------------
// Item limits and substitutes

export type ItemRules = { clash: (a: number, b: number) => boolean; substitute: (a: number, b: number) => boolean };
export function itemRules(k: Kinds | null | undefined): ItemRules {
  const groups = new Map<number, number[]>();
  (RULES.itemLimits.on ? (k?.limits ?? []) : []).forEach((g, n) => g.forEach((id) => groups.set(base(id), [...(groups.get(base(id)) ?? []), n])));
  const subs = new Set((RULES.substitutes.on ? (k?.substitutes ?? []) : []).map(([a, b]) => `${Math.min(base(a), base(b))}-${Math.max(base(a), base(b))}`));
  return {
    clash: (a, b) => base(a) !== base(b) && (groups.get(base(a)) ?? []).some((g) => (groups.get(base(b)) ?? []).includes(g)),
    substitute: (a, b) => subs.has(`${Math.min(base(a), base(b))}-${Math.max(base(a), base(b))}`),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Augments

export const COMBO_ODDS = 0.04;
export const COMBO_CAP = 0.12;
export const LUCKY_ODDS = 0.35;
export const LUCKY_CAP = 1;
export const REROLL_GAIN = 0.25;

export type RankedAugment = { id: number; score: number; boost: number | null; potential: number; combo: number | null; mate: number | null; deep: number };

/**
 * This champion's augments best first: real per-champion score, plus synergy with what you took, plus a share of the
 * best combo you could still complete (COMBO_ODDS per pick left, at most COMBO_CAP; "I'm feeling lucky" raises it).
 * A partner already shown this game can't come back, so it adds no potential.
 */
export function rankAugments(
  picks: Picks,
  champ: string,
  taken: number[],
  opts: { lucky?: boolean; seen?: number[] } = {},
): RankedAugment[] {
  const ck = keyIn(picks.champions, champ);
  const own = ck ? picks.champions[ck] : [];
  const pairs = (keyIn(picks.pairs, champ) && picks.pairs[keyIn(picks.pairs, champ)!]) || [];
  const gone = new Set(RULES.seenAugments.on ? (opts.seen ?? []) : []);
  const left = Math.max(0, 3 - taken.length);
  const odds = opts.lucky ? Math.min(LUCKY_CAP, LUCKY_ODDS * left) : Math.min(COMBO_CAP, COMBO_ODDS * left);
  return own
    .filter(([id]) => !taken.includes(id))
    .map(([id, score, deep = -1, est = 1]) => {
      let bonus = 0, mate: number | null = null, best = 0, potential = 0, combo: number | null = null;
      for (const [a, b, p] of pairs) {
        const other = a === id ? b : b === id ? a : null;
        if (other === null) continue;
        if (taken.includes(other)) {
          bonus += p;
          if (p > best) { best = p; mate = other; }
        } else if (!gone.has(other) && p > 0 && p * odds > potential) {
          potential = p * odds;
          combo = other;
        }
      }
      const baseScore = score * 100 + bonus;
      return { id, score: baseScore + potential, boost: est ? baseScore : null, potential, combo, mate, deep };
    })
    .sort((x, y) => y.score - x.score);
}

export type RerollAdvice = {
  /** "reroll": reroll `card`; "keep": nothing worth rerolling. */
  action: "reroll" | "keep";
  card: number | null;
  best: number;
  /** Share of the pool that beats the best card on offer. */
  beats: number;
  /** Expected points gained by rerolling `card`. */
  gain: number;
  rarity: string;
};

/**
 * Reroll or keep. Rerolling a card swaps it for one drawn evenly from this champion's pool at the offer's rarity,
 * minus the cards on screen, the ones you took and every augment already shown this game. Each card can be rerolled
 * once, so cards in `rerolled` are never named. Null when the pool is too small to judge.
 */
export function rerollAdvice(
  picks: Picks,
  ranked: RankedAugment[],
  offered: { id: number; score?: number | null }[],
  taken: number[],
  opts: { seen?: number[]; rerolled?: number[] } = {},
): RerollAdvice | null {
  if (!offered.length) return null;
  const r = picks.augments[offered[0].id]?.[1] ?? "";
  const gone = new Set([...taken, ...offered.map((o) => o.id), ...(RULES.seenAugments.on ? (opts.seen ?? []) : [])]);
  const pool = ranked.filter((a) => picks.augments[a.id]?.[1] === r && !gone.has(a.id)).map((a) => a.score);
  if (pool.length < 5) return null;
  const low = Math.min(...pool);
  const scoreOf = (o: { id: number; score?: number | null }) => o.score ?? ranked.find((a) => a.id === o.id)?.score ?? low;
  const v = offered.map(scoreOf);
  const best = Math.max(...v);
  const done = new Set(RULES.rerollOnce.on ? (opts.rerolled ?? []) : []);
  let pick = -1, gain = 0;
  v.forEach((_, j) => {
    if (done.has(offered[j].id)) return;
    const keep = Math.max(...v.filter((__, k) => k !== j), -Infinity);
    const g = pool.reduce((t, x) => t + Math.max(keep, x), 0) / pool.length - best;
    if (g > gain) { gain = g; pick = j; }
  });
  const beats = pool.filter((x) => x > best).length / pool.length;
  const min = RULES.rerollMinGain.on ? REROLL_GAIN : 0;
  const bestId = offered[v.indexOf(best)].id;
  return pick >= 0 && gain > 0 && gain >= min
    ? { action: "reroll", card: offered[pick].id, best: bestId, beats, gain, rarity: r }
    : { action: "keep", card: null, best: bestId, beats, gain, rarity: r };
}

// ---------------------------------------------------------------------------------------------------------------
// Enemy team

/** Enemy damage, 0 (all physical) to 1 (all magic): each champion's usual mix, pulled toward their finished items. */
export function enemyMagic(k: Kinds, enemies: Enemy[]): number | null {
  const lower = new Map(Object.entries(k.champions).map(([a, m]) => [a.toLowerCase(), m]));
  const mixes = enemies.filter((e) => e.champ).map((e) => {
    let ap = 0, ad = 0;
    if (RULES.itemDamageMix.on)
      for (const id of e.items) {
        const g = k.items[String(base(id))] ?? [];
        if (g.includes("ap") && !g.includes("ad")) ap += 1;
        if (g.includes("ad") && !g.includes("ap")) ad += 1;
      }
    return (2 * (lower.get(e.champ.toLowerCase()) ?? 0.5) + ap) / (2 + ap + ad);
  });
  return mixes.length ? mixes.reduce((a, b) => a + b, 0) / mixes.length : null;
}

const TANKY = new Set(["Vanguard", "Warden", "Juggernaut"]);
const BURSTY = new Set(["Burst", "Assassin"]);
const CATCH = new Set(["Catcher", "Vanguard"]);
// Life steal / omnivamp / big self-heal items, and shield or heal-and-shield-power items (PC 1.22.0).
export const SUSTAIN_ITEMS = new Set([3072, 3153, 3074, 4633, 3146, 6610, 6673, 3065, 3083]);
export const SHIELD_ITEMS = new Set([6617, 6620, 3504, 6616, 3107, 3190, 3222, 6621, 3053, 3040, 3156]);
// Champions whose kits heal a lot (from their ability descriptions), for "Vs healing" (PC 1.22.0, under audit).
export const HEALERS = new Set(["aatrox", "akshan", "alistar", "belveth", "briar", "drmundo", "fiddlesticks", "illaoi", "ivern", "kayn", "kled", "maokai", "milio", "nami", "nidalee", "olaf", "renataglasc", "senna", "sona", "soraka", "swain", "sylas", "taric", "trundle", "vladimir", "warwick", "yuumi", "zac", "seraphine", "darius", "fiora", "irelia", "masteryi", "udyr", "volibear", "yone"]);

/**
 * Counters that passed the mechanism test (2026-11-23, research/counter-items Steps 3 and 4): against their trigger
 * the buyer's share of that damage type dropped clearly more than with a matched other buy and than in the placebo.
 * These are real swaps; every other lit situational item stays a pointer.
 */
export const PROVEN: { when: string; items: number[] | "armor"; trigger: string }[] = [
  { when: "Vs magic damage", items: [2504, 3065, 3111], trigger: "magic" },
  { when: "Vs auto attacks", items: "armor", trigger: "marksmen" },
];

/** Each situation's reason in this game, or "" when it doesn't hold. */
export function triggers(k: Kinds, fit: Fit | null, enemies: Enemy[]): Record<string, string> {
  const list = enemies.filter((e) => e.champ);
  const arch = (e: Enemy) => fit?.champions?.[keyIn(fit.champions, e.champ) ?? ""]?.[1] ?? [];
  const count = (set: Set<string>) => list.filter((e) => arch(e).some((a) => set.has(a))).length;
  const tags = (e: Enemy) => e.items.flatMap((i) => k.items[String(base(i))] ?? []);
  const owns = (e: Enemy, set: Set<number>) => e.items.some((i) => set.has(base(i)));
  const tanky = list.filter((e) => arch(e).some((a) => TANKY.has(a)) || tags(e).filter((t) => t === "armor" || t === "mr").length >= 2).length;
  const crit = list.filter((e) => tags(e).filter((t) => t === "crit").length >= 2).length;
  const healers = list.filter((e) => HEALERS.has(champKey(e.champ)) || owns(e, SUSTAIN_ITEMS)).length;
  const shielders = list.filter((e) => arch(e).includes("Enchanter") || owns(e, SHIELD_ITEMS)).length;
  const marksmen = list.filter((e) => arch(e).includes("Marksman")).length;
  const magic = enemyMagic(k, list);
  const pct = (p: number) => `${Math.round(p * 100)}%`;
  const n = (x: number, what: string) => `${x} ${x === 1 ? "enemy" : "enemies"} ${what}.`;
  const proven = {
    "Vs magic damage": magic !== null && magic >= 0.65 ? `Enemy damage is about ${pct(magic)} magic.` : "",
    // Armor cut the share of physical damage taken vs 2+ marksmen (-7 ± 3 pts, placebo -2 ± 1).
    "Vs auto attacks": marksmen >= 2 ? n(marksmen, "are marksmen") : "",
  };
  if (!RULES.countTriggers.on) return proven;
  return {
    ...proven,
    "Vs tanks": tanky >= 2 ? n(tanky, tanky === 1 ? "is tanky" : "are tanky") : "",
    "Vs burst": count(BURSTY) >= 2 ? n(count(BURSTY), "deal burst damage") : "",
    "Vs healing": healers >= 2 ? n(healers, "heal a lot") : "",
    "Vs physical damage": magic !== null && magic <= 0.35 ? `Enemy damage is about ${pct(1 - magic)} physical.` : "",
    "Vs mixed damage": magic !== null && magic > 0.4 && magic < 0.6 ? "Enemy damage is mixed." : "",
    "Vs crit carries": crit >= 1 ? n(crit, "build crit") : "",
    "Vs shields": shielders >= 2 ? n(shielders, "shield themselves or allies") : "",
    "Vs heavy crowd control": count(CATCH) >= 3 ? n(count(CATCH), "lock you down") : "",
  };
}

export type LitItem = Situational & { why: string; aug?: boolean; proven?: boolean };

/**
 * The champion's situational items checked against this game: each gets the reason it applies now ("" when it
 * doesn't). Augment-driven entries light up once you take one of their augments and come first. Armor items also
 * answer "Vs auto attacks". `proven` marks the counters that passed the mechanism test.
 */
export function situational(champ: OverlayChamp | undefined, k: Kinds, fit: Fit | null, enemies: Enemy[], taken: number[], skip: Set<number>): LitItem[] {
  const own = champ?.situational ?? [];
  // Measured augment -> item patterns the champion's list doesn't already have.
  const prefix = ([...(champ?.items ?? []), ...own].find((it) => it.icon)?.icon ?? "").replace(/\d+\.png$/, "");
  const extra: Situational[] = RULES.augmentItems.on
    ? AUGMENT_ITEMS.filter((x) => taken.includes(x.augment) && k.recipes[x.item] && !own.some((it) => itemId(it.icon) === x.item)).map((x) => ({
        name: k.recipes[x.item][0],
        icon: `${prefix}${220000 + x.item}.png`,
        when: "Fits your augment",
        augments: [x.augment],
      }))
    : [];
  const list = [...own, ...extra].filter((it) => !skip.has(itemId(it.icon)));
  if (!list.length) return [];
  const t = triggers(k, fit, enemies);
  const has = new Set(taken.map(Number));
  const armor = (id: number) => (k.items[String(id)] ?? []).includes("armor");
  const out: LitItem[] = list.map((it) => {
    if (Array.isArray(it.augments))
      return { ...it, aug: true, why: it.augments.some((a) => has.has(Number(a))) ? it.why || it.when || "fits an augment you took" : "" };
    const id = itemId(it.icon);
    let why = t[it.when ?? ""] || "";
    let proven = false;
    if (RULES.provenCounters.on) {
      for (const p of PROVEN) {
        const fitsItem = p.items === "armor" ? armor(id) : p.items.includes(id);
        if (!fitsItem || !t[p.when]) continue;
        if (p.when === it.when || p.items === "armor") { why = t[p.when]; proven = true; }
      }
    }
    return { ...it, why, proven };
  });
  return [...out.filter((it) => it.aug && it.why), ...out.filter((it) => !(it.aug && it.why))];
}

// ---------------------------------------------------------------------------------------------------------------
// Build path

export const STYLE_NAMES: Record<string, string> = { crit: "Crit", onhit: "On-hit", ap: "AP", lethality: "Lethality", fighter: "AD", tank: "Tank", enchanter: "Enchanter" };
// Items that grow with time or takedowns: first while no legendary is finished (PC 1.22.0, under audit).
export const STACKING = new Set([6697, 3084, 3070, 3004, 3003, 3119]);
export const BACK_TO_BASICS = new Set([1004, 4]);
// Champions whose R has a passive that works once R has a point (Riot's R descriptions), so Back to Basics still
// levels R; for the rest it takes R's only use away (Nico 2026-11-20).
export const R_PASSIVE = new Set(["ambessa", "annie", "belveth", "blitzcrank", "fiora", "galio", "gnar", "jax", "kayn", "khazix", "lux", "masteryi", "mel", "nidalee", "olaf", "pantheon", "reksai", "rengar", "ryze", "shyvana", "sona", "syndra", "teemo", "xinzhao", "zaahen"]);
// Augments that change how a champion builds whatever the style tags say (PC 1.22.0, under audit): 3 votes each.
export const BUILD_CHANGERS: Record<number, string[]> = { 1029: ["onhit"], 2018: ["ap"], 2123: ["ap"], 1388: ["ap"], 1205: ["ap"], 1206: ["lethality", "fighter"], 3049: ["tank"], 1324: ["tank"], 1353: ["tank"] };
// Measured augment -> build switches (website thread, 2026-11-23): the only ones on.
export const MEASURED_SWITCHES: Record<number, string> = { 1029: "onhit" };
// Measured augment -> item patterns: build share with the augment vs without, same champions.
export const AUGMENT_ITEMS: { augment: number; item: number }[] = [
  { augment: 1134, item: 6333 },
  { augment: 3049, item: 3075 },
  { augment: 1324, item: 3190 },
];
// "Upgrade X" augments and the items they upgrade (the augment's own name; Immolate and Sheen name item families).
export const UPGRADES: Record<number, number[]> = {
  1318: [3157], 1319: [3068, 6664, 2502], 1320: [6676], 1336: [3031], 1379: [4011], 1996: [3078, 3100, 6662, 3508, 2510],
  2140: [3074], 2143: [6610], 2157: [6333], 3150: [4646],
};
export const WEAPON_OF_DESTINY = 3081;

/** A style build for a champion with none of that style: the style's usual items over all champions. */
export function classBuild(picks: Picks, k: Kinds, style: string, magic: boolean, rules: ItemRules): [number[], number[]] | null {
  const score: Record<number, number> = {}, core: Record<number, number> = {};
  for (const builds of Object.values(picks.builds ?? {}))
    for (const [st, share, , c3, rest] of builds) {
      if (st !== style) continue;
      c3.forEach((id) => { score[id] = (score[id] ?? 0) + share; core[id] = (core[id] ?? 0) + share; });
      rest.forEach((id, i) => { score[id] = (score[id] ?? 0) + share * (1 - i * 0.15); });
    }
  const fits = (id: number) => { const t = k.items[String(base(id))] ?? []; return style === "tank" || t.includes(magic ? "ap" : "ad"); };
  const ids = Object.keys(score).map(Number).filter(fits);
  const pickFree = (cands: number[], n: number, keep: number[]) => {
    const out: number[] = [];
    for (const id of cands) if (out.length < n && ![...keep, ...out].some((o) => rules.clash(o, id))) out.push(id);
    return out;
  };
  const byCore = pickFree([...ids].sort((a, b) => (core[b] ?? 0) - (core[a] ?? 0)), 3, []);
  const rest = pickFree(ids.filter((id) => !byCore.includes(id)).sort((a, b) => score[b] - score[a]), 5, byCore);
  return byCore.length === 3 ? [byCore, rest] : null;
}

export type BuildPick = { list: Named[]; style: string | null; core: number | null; because?: string; classWide?: boolean };

/**
 * The build to follow: the champion's usual one or, once the augments you took point to another style (on-hit, AP,
 * tank...), that style: the champion's own build of it if players make one, else the class-wide style build. Only
 * what you haven't bought is re-planned: items you own stay.
 */
export function pickBuild(base0: Named[], picks: Picks | null, k: Kinds | null, champ: string, taken: number[], owned: Set<number>, rules: ItemRules): BuildPick {
  if (!(RULES.augmentReplan.on || RULES.measuredReplan.on) || !taken.length || !k || !picks) return { list: base0, style: null, core: null };
  const ck = keyIn(picks.builds, champ);
  const styles = ck ? picks.builds![ck] : [];
  const votes: Record<string, number> = {}, because: Record<string, number> = {};
  for (const id of taken) {
    const measured = RULES.measuredReplan.on && MEASURED_SWITCHES[id] ? [MEASURED_SWITCHES[id]] : undefined;
    const strong = measured ?? (RULES.augmentReplan.on ? BUILD_CHANGERS[id] : undefined);
    for (const st of strong ?? (RULES.augmentReplan.on ? picks.styles[id] : undefined) ?? []) {
      votes[st] = (votes[st] ?? 0) + (strong ? 3 : 1);
      if (strong) because[st] = id;
    }
  }
  const top = Object.entries(votes).sort((x, y) => y[1] - x[1])[0];
  if (!top) return { list: base0, style: null, core: null };
  const [st, n] = top;
  if (styles[0]?.[0] === st) return { list: base0, style: null, core: null };
  const found = styles.find(([x]) => x === st);
  let plan: number[][] | null = found ? [found[2].slice(0, 1), found[3], found[4]] : null;
  if (!plan && n >= 3 && RULES.augmentReplan.on) {
    const magic = (Object.entries(k.champions).find(([a]) => a.toLowerCase() === champ.toLowerCase())?.[1] ?? 0.5) > 0.5;
    const cb = classBuild(picks, k, st, magic, rules);
    const boots = base0.find((it) => k.boots.includes(itemId(it.icon)));
    if (cb) plan = [boots ? [itemId(boots.icon)] : [], cb[0], cb[1]];
  }
  if (!plan) return { list: base0, style: null, core: null };
  const prefix = (base0[0]?.icon ?? "").replace(/\d+\.png$/, "");
  // build lists mix plain ids and Mayhem ids; the art for finished items sits under the Mayhem id (22 + id)
  const mk = (id: number): Named => {
    const b = base(id), fin = id >= 220000 || (k.recipes[b]?.[1] ?? 0) >= 2000;
    return { name: k.recipes[b]?.[0] ?? `#${id}`, icon: `${prefix}${id >= 100000 && id < 220000 && !fin ? b : fin ? 220000 + b : b}.png` };
  };
  const fresh = [...plan[0].slice(0, 1), ...plan[1], ...plan[2]].map(mk);
  const kept = base0.filter((it) => owned.has(itemId(it.icon)));
  const keptIds = kept.map((it) => itemId(it.icon));
  const list: Named[] = [...kept];
  for (const it of fresh) {
    const id = itemId(it.icon);
    if (keptIds.includes(id) || owned.has(id) || list.some((x) => rules.clash(itemId(x.icon), id))) continue;
    list.push(it);
  }
  const why = because[st] ? (picks.augments[because[st]]?.[0] ?? "") : "";
  const sized = list.slice(0, 6);
  return { list: sized, style: STYLE_NAMES[st] ?? st, core: Math.min(sized.length, (plan[0].length ? 1 : 0) + 3), because: why, classWide: !found };
}

/**
 * One pick per 4th/5th/6th item slot: an owned item from the slot's list, else the site's "full" path pick, else the
 * slot's first item, never one that clashes with the core or an earlier pick. Null without slot data.
 */
export function laterPicks(champ: OverlayChamp | undefined, owned: Set<number>, rules: ItemRules): { slot: number; it: Named; alts: Named[] }[] | null {
  const slots = champ?.laterSlots;
  if (!slots?.length) return null;
  const used = (champ?.items ?? []).map((it) => itemId(it.icon));
  const ok = (id: number) => !used.includes(id) && !used.some((u) => rules.clash(u, id));
  const fullRest = (champ?.full ?? []).filter((it) => it?.icon && !used.includes(itemId(it.icon)));
  // Six items in all, boots included, as on the site's card (lib/card-score.ts fullPicks).
  const room = Math.max(0, 6 - (champ?.items ?? []).length);
  const out: { slot: number; it: Named; alts: Named[] }[] = [];
  [...slots].sort((a, b) => a.slot - b.slot).slice(0, room).forEach((s, n) => {
    const pick = fullRest[n] && ok(itemId(fullRest[n].icon)) ? [fullRest[n]] : [];
    const items = [...pick, ...(s.items ?? []).filter((x) => !pick.length || itemId(x.icon) !== itemId(pick[0].icon))];
    const free = items.filter((it) => ok(itemId(it.icon)));
    const it = free.find((x) => owned.has(itemId(x.icon))) ?? free[0];
    if (!it) return;
    used.push(itemId(it.icon));
    out.push({ slot: s.slot, it, alts: free.filter((x) => x !== it).slice(0, 2) });
  });
  return out.length ? out : null;
}

/** What your gold buys now toward the next item: the item itself, else its priciest missing part you can afford. */
export function buyNow(k: Kinds, nextId: number, owned: Set<number>, gold: number): { id: number; name: string; whole: boolean; cost?: number } | null {
  const r = k.recipes[nextId];
  if (!r) return null;
  const have = r[2].filter((c) => owned.has(c)).reduce((sum, c) => sum + (k.recipes[c]?.[1] ?? 0), 0);
  if (gold >= r[1] - have) return { id: nextId, name: r[0], whole: true };
  const parts = r[2].filter((c) => !owned.has(c) && (k.recipes[c]?.[1] ?? 1e9) <= gold).sort((x, y) => k.recipes[y][1] - k.recipes[x][1]);
  return parts.length ? { id: parts[0], name: k.recipes[parts[0]][0], whole: false, cost: k.recipes[parts[0]][1] } : null;
}

/** On level-up: where the point goes. R at 6, 11 and 16; with Back to Basics only when R has a passive. */
export function skillUp(order: string[] | undefined, pts: number[], level: number, taken: number[], champ: string): string {
  const spent = pts.reduce((a, b) => a + b, 0);
  if (!order?.length || !pts.length || spent >= level) return "";
  const noR = !R_PASSIVE.has(champKey(champ)) && taken.some((id) => BACK_TO_BASICS.has(id));
  const rDue = [6, 11, 16].filter((l) => l <= level).length;
  if (!noR && pts[3] < rDue) return "R";
  const idx: Record<string, number> = { Q: 0, W: 1, E: 2 };
  const cap = Math.min(5, Math.ceil(level / 2));
  const first = level <= 3 && order.find((key) => pts[idx[key]] === 0);
  return first || order.find((key) => pts[idx[key]] < cap) || "";
}

// ---------------------------------------------------------------------------------------------------------------
// The plan

export type Swap = { item: Named; replaces: Named | null; at: number; why: string; kind: "augment" | "proven" };
export type Tip = { rank: number; kind: string; text: string; item?: number };
export type Plan = {
  /** The whole path in buying order: core, then the 4th/5th/6th picks. */
  path: Named[];
  coreLen: number;
  /** Up to two items to buy next, first one first. */
  next: Named[];
  /** One line per path item: why it's there. */
  why: string[];
  /** Path items this game calls for, with the reason. */
  lit: { item: Named; why: string }[];
  /** Real swaps: augment-driven or proven counters. Each replaces the item it clashes or substitutes with, else the
   *  last open slot. */
  swaps: Swap[];
  /** Lit situational items that aren't proven: shown as a pointer only. */
  pointers: { item: Named; why: string; replaces: Named | null }[];
  /** Your augments switched the build. */
  switched: { style: string; because: string; classWide: boolean; instead: Named | null } | null;
  /** Items moved up for an augment you took. */
  timing: { item: Named; because: string }[];
  tips: Tip[];
  /** The rules this plan used, with their sources (RULES). */
  rules: string[];
};

export type PlanInput = {
  champ: OverlayChamp | undefined;
  kinds: Kinds | null;
  picks: Picks | null;
  fit: Fit | null;
  game: GameState;
  taken: number[];
};

const ord = (n: number) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

export function plan({ champ, kinds: k, picks, fit, game, taken }: PlanInput): Plan {
  const rules = itemRules(k);
  const used = new Set<string>();
  const applied = (r: string) => used.add(r);
  const owned = new Set(game.items.map(base));
  const bootIds = new Set(k?.boots ?? []);
  let slotRows = laterPicks(champ, owned, rules);
  if (slotRows && RULES.itemLimits.on) applied("itemLimits");
  // Finished items you own that the path doesn't list take the first later slots you haven't filled.
  if (slotRows && k && RULES.ownedOffPath.on) {
    const listed = new Set([...(champ?.items ?? []), ...slotRows.map((r) => r.it)].map((it) => itemId(it.icon)));
    const prefix = ((champ?.items ?? []).find((it) => it.icon)?.icon ?? "").replace(/\d+\.png$/, "");
    const extra = [...owned].filter((i) => (k.recipes[i]?.[1] ?? 0) >= 2000 && !(k.boots ?? []).includes(i) && !listed.has(i));
    for (const i of extra) {
      const row = slotRows.find((r) => !owned.has(itemId(r.it.icon)));
      if (!row) break;
      row.alts = [row.it, ...row.alts].slice(0, 2);
      row.it = { name: k.recipes[i][0], icon: `${prefix}${220000 + i}.png` };
      applied("ownedOffPath");
    }
    // a later pick that can't be owned with something you have gives way to its first alternative that can
    for (const r of slotRows)
      if (!owned.has(itemId(r.it.icon)) && [...owned].some((o) => rules.clash(o, itemId(r.it.icon)))) {
        const alt = r.alts.find((x) => ![...owned].some((o) => rules.clash(o, itemId(x.icon))));
        if (alt) r.it = alt;
      }
    slotRows = slotRows.filter((r) => owned.has(itemId(r.it.icon)) || ![...owned].some((o) => rules.clash(o, itemId(r.it.icon))));
  }
  const baseList = [...(champ?.items ?? []), ...(slotRows ? slotRows.map((r) => r.it) : (champ?.rest ?? []))];
  const picked = pickBuild(baseList, picks, k, game.champ, taken, owned, rules);
  if (picked.style) { slotRows = null; applied(RULES.augmentReplan.on ? "augmentReplan" : "measuredReplan"); }
  const build = picked.list;
  const coreLen = picked.core ?? (champ?.items ?? []).length;
  const hasBoots = [...owned].some((i) => bootIds.has(i));
  const isOwned = (it: Named) => owned.has(itemId(it.icon)) || (hasBoots && bootIds.has(itemId(it.icon)));
  let next = build.filter((it) => !isOwned(it));
  const finished = [...owned].filter((i) => (k?.recipes[i]?.[1] ?? 0) >= 2000 && !bootIds.has(i)).length;
  const timing: { item: Named; because: string }[] = [];
  const augName = (id: number) => picks?.augments[id]?.[0] ?? `#${id}`;
  const front = (idx: number, because: string) => {
    if (idx <= 0) { if (idx === 0) timing.push({ item: next[0], because }); return; }
    timing.push({ item: next[idx], because });
    next = [next[idx], ...next.filter((_, i) => i !== idx)];
  };
  // Augment-aware timing: Weapon of Destiny makes the first legendary its weapon, so the champion's best Weapon item
  // (AramHex real games) goes first. "Upgrade X" moving X up is off until tested (RULES.upgradeNext).
  if (RULES.destinyFirst.on && taken.includes(WEAPON_OF_DESTINY) && !finished && champ?.destiny) {
    const idx = next.findIndex((it) => itemId(it.icon) === itemId(champ.destiny!.icon));
    if (idx >= 0) { front(idx, `${augName(WEAPON_OF_DESTINY)}: your first legendary becomes the Weapon`); applied("destinyFirst"); }
  }
  const upgraded = new Map<number, string>();
  for (const a of taken) for (const id of UPGRADES[a] ?? []) if (RULES.upgradeLabel.on) upgraded.set(id, augName(a));
  if (RULES.upgradeNext.on)
    for (const a of taken) {
      const family = UPGRADES[a];
      if (!family) continue;
      const idx = next.findIndex((it) => family.includes(itemId(it.icon)));
      if (idx >= 0 && !timing.some((t) => t.item === next[idx])) { front(idx, `${augName(a)} upgrades it`); applied("upgradeNext"); }
    }
  const stack = RULES.stackingFirst.on && !finished && !timing.length ? next.findIndex((it) => STACKING.has(itemId(it.icon))) : -1;
  if (stack > 0) { next = [next[stack], ...next.filter((_, i) => i !== stack)]; applied("stackingFirst"); }
  const [, aspd = 0, haste = 0] = game.stats ?? [];
  const has = (it: Named, kind: string) => (k?.items[String(itemId(it.icon))] ?? []).includes(kind);
  const nearCap = RULES.attackSpeedNudge.on && aspd >= 4.5;
  if (nearCap) { next = [...next.filter((it) => !has(it, "as")), ...next.filter((it) => has(it, "as"))]; applied("attackSpeedNudge"); }
  next = next.slice(0, 2);

  // Path: the core, then the 4th/5th/6th picks (or the rest of the build).
  const coreItems = build.slice(0, coreLen);
  const rest = slotRows ? slotRows.map((r) => r.it) : build.slice(coreLen, 6);
  const path = [...coreItems, ...rest];
  const first = coreItems.filter((it) => !bootIds.has(itemId(it.icon))).length + 1;
  const slotName = (i: number) => ord(slotRows?.[i]?.slot ?? first + i);

  // Situational: lit items in the path explain themselves; the rest become swaps (augment-driven or proven) or
  // pointers.
  const inPath = new Set(path.map((it) => itemId(it.icon)));
  const all = k ? situational(champ, k, fit, game.enemies ?? [], taken, owned) : [];
  const reason = (it: Named) => all.find((x) => itemId(x.icon) === itemId(it.icon) && x.why);
  const lit = path.map((it) => ({ item: it, why: reason(it)?.why ?? "" })).filter((x) => x.why);
  const open = rest.filter((it) => !isOwned(it) && it !== next[0]);
  const target = (id: number, taken0: Set<Named>): Named | null => {
    const unbought = path.filter((p) => !isOwned(p) && !taken0.has(p));
    const clash = unbought.find((p) => rules.clash(itemId(p.icon), id)) ?? path.find((p) => rules.clash(itemId(p.icon), id));
    if (clash) return clash;
    const sub = unbought.find((p) => rules.substitute(itemId(p.icon), id));
    if (sub) { applied("substitutes"); return sub; }
    if (!RULES.swapLastSlot.on) return null;
    return [...open].reverse().find((p) => !taken0.has(p)) ?? null;
  };
  const swaps: Swap[] = [];
  const pointers: Plan["pointers"] = [];
  const claimed = new Set<Named>();
  for (const it of all.filter((x) => x.why && !inPath.has(itemId(x.icon)))) {
    const id = itemId(it.icon);
    // never alongside an item you own that it can't be owned with
    const ownedClash = [...owned].find((o) => rules.clash(o, id));
    if (ownedClash !== undefined && !path.some((p) => itemId(p.icon) === ownedClash && !isOwned(p))) {
      pointers.push({ item: it, why: it.why, replaces: { name: k?.recipes[ownedClash]?.[0] ?? `#${ownedClash}`, icon: null } });
      continue;
    }
    if ((it.aug || it.proven) && swaps.length < 2) {
      const r = target(id, claimed);
      if (r) claimed.add(r);
      swaps.push({ item: it, replaces: r, at: r ? rest.indexOf(r) : -1, why: it.why, kind: it.aug ? "augment" : "proven" });
      if (it.proven) applied("provenCounters");
    } else if (pointers.length < 1) {
      pointers.push({ item: it, why: it.why, replaces: target(id, claimed) });
    }
  }

  // Why each path item is there.
  const why = path.map((it, i) => {
    if (isOwned(it)) return "You have it.";
    const r = reason(it);
    const tm = timing.find((t) => t.item === it);
    const b = picked.style
      ? `Switched to ${picked.style}${picked.because ? ` for ${picked.because}` : ""}${picked.classWide ? ": usual item for that style" : ""}.`
      : i < coreLen
        ? "Core: the most played build here with the best DeepScore."
        : slotRows
          ? `${slotName(i - coreLen)} item: players usually buy it ${slotName(i - coreLen)}.`
          : "Usually finishes this build.";
    const up = upgraded.get(itemId(it.icon));
    if (up) applied("upgradeLabel");
    return [tm ? `Earlier: ${tm.because}.` : "", b, up ? `${up} upgrades it.` : "", r ? `${r.when}: ${r.why}` : ""].filter(Boolean).join(" ");
  });

  // Tips, most useful first.
  const tips: Tip[] = [];
  const point = skillUp(champ?.skills, game.skills ?? [], game.level ?? 0, taken, game.champ);
  if (point) tips.push({ rank: 1, kind: "skill", text: point });
  const shop = game.dead ? "You're dead: a good time to shop." : (game.t ?? 999) < 60 ? "In base: a good time to shop." : "";
  if (shop) tips.push({ rank: 0, kind: "shop", text: shop });
  if (RULES.shopTips.on && shop && k && next.length) {
    const buy = buyNow(k, itemId(next[0].icon), owned, game.gold ?? 0);
    if (buy) tips.push({ rank: 2, kind: "buy", item: buy.id, text: buy.whole ? `Your gold buys ${buy.name} now.` : `Buy ${buy.name} now (${buy.cost} gold) toward it.` });
  }
  if (nearCap) tips.push({ rank: 3, kind: "cap", text: "Attack speed is near Mayhem's 5.0 cap: attack-speed items moved back." });
  else if (RULES.hasteMath.on && haste >= 100 && next[0] && has(next[0], "haste"))
    tips.push({ rank: 3, kind: "haste", text: `You have ${Math.round(haste)} ability haste: cooldowns are ${Math.round((haste / (100 + haste)) * 100)}% shorter.` });
  if (stack > 0) tips.push({ rank: 4, kind: "stacking", item: itemId(next[0].icon), text: `${next[0].name} stacks over time, so it goes first.` });
  for (const t of timing.slice(0, 1)) tips.push({ rank: 4, kind: "timing", item: itemId(t.item.icon), text: `${t.item.name} next: ${t.because}.` });
  if (RULES.shopTips.on && k && next.length) {
    const slots = game.items.filter((i) => (k.recipes[base(i)]?.[1] ?? 0) > 0 && !bootIds.has(base(i))).length + (hasBoots ? 1 : 0);
    if (slots >= 6) {
      const inBuild = new Set(build.map((it) => itemId(it.icon)));
      const sell = [...owned].find((i) => (k.recipes[i]?.[1] ?? 0) >= 2000 && !inBuild.has(i) && !bootIds.has(i));
      const cost = k.recipes[itemId(next[0].icon)]?.[1] ?? Infinity;
      if (sell !== undefined && (game.gold ?? 0) + Math.round((k.recipes[sell]?.[1] ?? 0) * 0.7) >= cost)
        tips.push({ rank: 3, kind: "sell", item: sell, text: `Full build: sell ${k.recipes[sell][0]} for ${next[0].name}.` });
    }
  }
  tips.sort((x, y) => x.rank - y.rank);

  const baseNext = baseList.find((it) => !isOwned(it)) ?? null;
  return {
    path,
    coreLen,
    next,
    why,
    lit,
    swaps,
    pointers,
    switched: picked.style
      ? { style: picked.style, because: picked.because ?? "", classWide: !!picked.classWide, instead: baseNext && next[0] && itemId(baseNext.icon) !== itemId(next[0].icon) ? baseNext : null }
      : null,
    timing,
    tips,
    rules: [...used],
  };
}
