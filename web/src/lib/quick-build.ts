// The champion page's quick build for every champion, with names and icons resolved: skill order, summoner
// spells, boots, core and situational items, and the top augments as ranked on the page. Feeds /data/watch.json (Apple Watch)
// and /data/overlay.json (the desktop app's in-game overlay).
import { clashWith } from "./item-limits";
import { AUGMENT_SKILLS, CHAMPION_SKILLS, CHAMPION_SPLITS, type AugmentSkill, type SkillSplit } from "./augment-skills";
import { augmentScores, byScore as augmentOrder } from "@/lib/champion-augments";
import type { AugmentSwap } from "@/lib/build-plan";
import { buildOrder, championPage, scoreRows, type ItemRow, type SituationRow } from "@/lib/champion-page";
import { leading, SPELL_FOLLOWING, SPELL_MIN_GAMES } from "@/lib/card-score";
import { FIT } from "@/lib/deepscore";
import { champList } from "@/lib/champions";
import { fillSpells } from "@/lib/fill";
import { liveTiers } from "@/lib/highlights";
import { SITUATIONS } from "@/lib/situations";

export const RARITIES = ["prismatic", "gold", "silver"] as const;
export type Rarity = (typeof RARITIES)[number];
export type Named = { name: string; icon: string | null; /** Riot's item or augment id (the Simulator maps builds by it). */ id?: number };

/** Archmage (lib/archmage-route.ts). */
const ARCHMAGE = 2087;

export type QuickBuild = {
  id: string;
  name: string;
  tier: string | null;
  winRate: number | null;
  deepScore: number | null;
  skills: string[];
  spells: Named[];
  /** Starting items that build into the core (none when no common start does). */
  start: Named[];
  /** Boots (when the champion buys them) and the best core, in buying order. */
  items: Named[];
  /** The rest of the usual six-item build after the core, most built first. */
  rest: Named[];
  /** The items to buy after the core, one by one with their own numbers, as on the champion page's card
   *  (lib/card-score.ts laterItems). */
  later: LaterItem[];
  /** The same items split by the slot players buy them in (4th, 5th, 6th item), when the buying order is known. */
  laterSlots: { slot: number; items: LaterItem[] }[];
  /** The card's top six-item path after the core: the rest of the best real six-item build with a following that holds
   *  the core (lib/card-score.ts realFullPicks), else the best 4th, 5th and 6th picks (fullPicks). */
  full: LaterItem[];
  /** Items to swap in after the core, each with when to buy it ("Vs healing", "With Ethereal Weapon"), as on the
   *  champion page's card, and the build item it replaces when the game won't let you own both (lib/item-limits.ts).
   *  Augment-triggered entries also carry the augment ids and a one-line reason. */
  /** Situation rows best DeepScore first, then augment tips best first (Nico 2026-11-24); each carries its item's
   *  DeepScore so the apps keep that order. */
  situational: (Named & { when: string; why?: string; augments?: number[]; replaces?: Named; deepScore?: number | null })[];
  /** Components to rush for the first core item. */
  rush: Named[];
  /** "This augment upgrades this item" (the augment's own effect). Not a buy-order tip: when to buy it is unmeasured. */
  swaps: { augment: Named; item: Named }[];
  /** Top augments per rarity, each with its DeepScore on this champion when there's an estimate. */
  augments: Record<Rarity, (Named & { deepScore?: number })[]>;
  /** With two or more build styles (crit and AP Ashe): each style's own card, best DeepScore first; the fields above
   *  are the first one's. Augments per style are estimated (build tags). Same switch as the champion page. */
  /** AP Ashe with Archmage (lib/archmage-route.ts): the haste route per set of loop augments, with the AP build's
   *  skill order. The build engine follows it once Archmage is taken. Estimated. */
  archmage?: {
    augment: number;
    style: string;
    skills: string[];
    routes: { with: number[]; eRank: number; need: number | null; reach: boolean; items: Named[]; routeLen: number }[];
  };
  /** Skill max orders once an augment is taken (lib/augment-skills.ts, Nico's calls). The build engine follows them. */
  augmentSkills?: AugmentSkill[];
  /** Points into one ability before the order (lib/augment-skills.ts CHAMPION_SPLITS, Nico's pick). */
  skillSplit?: SkillSplit;
  /** The start once an augment is taken first (Upgrade Stormsurge: Hextech Alternator), estimated. The engine's startFor. */
  /** toward = the item to spend extra gold on with that augment (Upgrade X: X), when there is one. */
  augmentStarts?: { augment: number; start: Named[]; toward?: number }[];
  /** Starts above the starting gold, best first: the engine's startFor takes the first you can afford (Debonair). */
  richStarts?: { start: Named[]; cost: number }[];
  builds: (Pick<QuickBuild, "skills" | "start" | "items" | "rest" | "full" | "later" | "laterSlots" | "situational" | "rush" | "augments"> & { style: string; share: number; deepScore: number; nearBest: boolean })[];
};

/** No raw win or pick rates: the quick build feeds the public app's overlay (tests/unit/overlay-data.test.ts). */
type LaterItem = Named & { deepScore: number | null };

export function quickBuilds(): QuickBuild[] {
  const tiers = new Map(liveTiers().map((t) => [t.id, t]));
  return champList().flatMap(({ id, name }) => {
    const p = championPage(id);
    if (!p) return [];
    const t = tiers.get(id);
    // Same picks as the champion page's card: the best core (with boots when the champion buys them), then the
    // best item for each situation.
    const named = (i: number | undefined) =>
      i !== undefined && p.itemInfo[i] ? { name: p.itemInfo[i].name, icon: p.itemInfo[i].icon ?? null, id: i } : null;
    const itemScore = new Map(p.items.map((r) => [r.items[0], r.deepScore ?? null]));
    const laterOf = (r: ItemRow) => {
      const n = named(r.items[0]);
      return n ? [{ ...n, deepScore: r.deepScore ?? null }] : [];
    };
    const pieces = (core: ItemRow | undefined, st: ItemRow | null, situ: SituationRow[], rushIds: number[], augSwaps: AugmentSwap[]) => ({
      items: (core ? buildOrder(core) : []).flatMap((i) => named(i) ?? []),
      start: (st?.items ?? []).flatMap((i) => named(i) ?? []),
      rest: (core?.rest ?? []).flatMap((i) => named(i) ?? []),
      full: (core?.full ?? []).flatMap(laterOf),
      later: (core?.later ?? []).flatMap(laterOf),
      laterSlots: (core?.slots ?? []).map((sl) => ({ slot: sl.slot, items: sl.items.flatMap(laterOf) })),
      situational: situ.flatMap((s): QuickBuild["situational"] => {
        const id = s.options[0]?.items[0];
        const n = named(id);
        return n ? [{ ...n, when: SITUATIONS[s.situation], deepScore: s.options[0].deepScore ?? null }] : [];
      }).concat(augSwaps.flatMap((sw) => {
        const n = named(sw.item);
        const a = p.augments.find((x) => sw.augments.includes(x.id));
        return n && a ? [{ ...n, when: `With ${a.name}`, why: sw.why, augments: sw.augments, deepScore: itemScore.get(sw.item) ?? null }] : [];
      })).map((s) => {
        // An item the game won't let you own with one of the build's items swaps that one out (Mortal Reminder for
        // Lord Dominik's): name it, so the card and the apps replace it instead of adding a seventh item.
        const id = Number(/(\d+)\.png$/.exec(s.icon ?? "")?.[1] ?? NaN);
        const clash = Number.isNaN(id) ? undefined : clashWith(id, [...(core?.items ?? []), ...(core?.rest ?? []), ...(core?.full ?? []).map((r) => r.items[0])]);
        const replaces = named(clash);
        return replaces ? { ...s, replaces } : s;
      }),
      rush: rushIds.flatMap((i) => named(i) ?? []),
    });
    const rawSpells = fillSpells(id, t?.winRate ?? p.winRate ?? 0.5);
    const spells = (rawSpells.some((r) => r.estimated) ? rawSpells : leading(scoreRows(rawSpells, FIT.items, { bound: true }), SPELL_FOLLOWING, SPELL_MIN_GAMES))[0];

    const swaps = p.swaps.flatMap((sw) => {
      const item = named(sw.item);
      const a = p.augments.find((x) => x.id === sw.augment);
      return item && a ? [{ augment: { name: a.name, icon: `/icons/augments/${a.id}.webp` }, item }] : [];
    });
    // The site's one augment ranking for this champion (lib/champion-augments.ts), as on its page.
    const deep = augmentScores(id);
    const byScore = [...p.augments].sort(augmentOrder(deep));
    const augsOf = (ids?: number[]) => {
      const keep = ids ? byScore.filter((a) => ids.includes(a.id)) : [];
      const list = keep.length >= 3 ? keep : byScore;
      return Object.fromEntries(
      RARITIES.map((r) => [
        r,
        list
          .filter((a) => a.rarity === r)
          .slice(0, 3)
          .map((a) => ({ name: a.name, icon: `/icons/augments/${a.id}.webp`, id: a.id, deepScore: deep.get(a.id) })),
      ]),
    ) as QuickBuild["augments"];
    };
    // Feeling lucky (lib/engine luckyBuild): a style counts as a near-tie with the best when their win rates' 95%
    // ranges overlap. Only the yes/no ships, never the win rates.
    const lead = p.builds[0];
    const se = (b: { winRate: number; games: number }) => (b.winRate * (1 - b.winRate)) / Math.max(1, b.games);
    const near = (b: { winRate: number; games: number }) =>
      !!lead && b !== lead && lead.games > 0 && b.games > 0 && Math.abs(lead.winRate - b.winRate) <= 1.96 * Math.sqrt(se(lead) + se(b));
    const builds = p.builds.map((b) => ({
      style: b.style,
      share: Math.round(b.share * 1000) / 1000,
      deepScore: b.deepScore,
      nearBest: near(b),
      // Skill orders per build style where enough players took it (lib/skill-orders.ts), else the champion's; Nico's
      // per-champion order wins over both (lib/augment-skills.ts CHAMPION_SKILLS).
      skills: CHAMPION_SKILLS[id] ?? b.skills[0]?.max ?? p.skills[0]?.max ?? [],
      ...pieces(b.core, b.start, b.situational, b.rush, b.augmentSwaps),
      augments: augsOf(b.augments),
    }));
    const apArch = p.builds.find((b) => b.archmage?.length);
    const arch = apArch
      ? {
          augment: ARCHMAGE,
          style: apArch.style,
          skills: CHAMPION_SKILLS[id] ?? apArch.skills[0]?.max ?? p.skills[0]?.max ?? [],
          routes: apArch.archmage!.map((r) => ({ ...r, items: r.items.flatMap((i) => named(i) ?? []) })),
        }
      : null;
    const augStarts = p.augmentStarts.flatMap((a) => {
      const start = a.items.flatMap((i) => named(i) ?? []);
      return start.length ? [{ augment: a.augment, start, ...(a.toward ? { toward: a.toward } : {}) }] : [];
    });
    const rich = p.richStarts.slice(0, 3).flatMap((r) => {
      const start = r.items.flatMap((i) => named(i) ?? []);
      return start.length === r.items.length ? [{ start, cost: r.cost }] : [];
    });
    const first = builds[0] ?? { ...pieces(p.core[0], p.cardStart, p.situational, p.rush, p.augmentSwaps), augments: augsOf() };
    const { start, items, rest, full, later, laterSlots, situational, rush, augments } = first;
    return [
      {
        id,
        name,
        tier: t?.tier ?? null,
        winRate: t?.winRate ?? null,
        deepScore: t?.deepScore ?? null,
        skills: builds[0]?.skills ?? CHAMPION_SKILLS[id] ?? p.skills[0]?.max ?? [],
        spells: spells?.spells.map((s) => ({ name: s.name, icon: s.icon ?? null })) ?? [],
        start,
        items,
        rest,
        full,
        later,
        laterSlots,
        situational,
        rush,
        swaps,
        augments,
        builds,
        ...(arch ? { archmage: arch } : {}),
        ...(AUGMENT_SKILLS[id] ? { augmentSkills: AUGMENT_SKILLS[id] } : {}),
        ...(CHAMPION_SPLITS[id] ? { skillSplit: CHAMPION_SPLITS[id] } : {}),
        ...(augStarts.length ? { augmentStarts: augStarts } : {}),
        ...(rich.length ? { richStarts: rich } : {}),
      },
    ];
  });
}
