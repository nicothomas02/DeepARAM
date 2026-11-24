/* eslint-disable @next/next/no-img-element -- small local icons */
import { AUGMENT_SKILLS, CHAMPION_SKILLS, CHAMPION_SPLITS } from "@/lib/augment-skills";
import type { Metadata } from "next";
import { SHOW_AUGMENT_WIN_RATES } from "@/lib/augment-policy";
import { Breadcrumbs } from "@/components/JsonLd";
import Link from "next/link";
import RowLink from "@/components/RowLink";
import SplashAccent from "@/components/SplashAccent";
import WinRateChart from "@/components/WinRateChart";
import WinRate, { Sampled } from "@/components/WinRate";
import DeepScore from "@/components/DeepScore";
import { BUILD_DEEPSCORE_HELP, FIT, ITEM_DEEPSCORE_HELP } from "@/lib/deepscore";
import FewPlayers from "@/components/champion/FewPlayers";
import BuildWhy from "@/components/champion/BuildWhy";
import BracketRates from "@/components/champion/BracketRates";
import { championBrackets } from "@/lib/brackets";
import { buildWhy } from "@/lib/why-best";
import ChampionShowcase from "@/components/ChampionShowcase";
import { notFound } from "next/navigation";
import { championAliases, championSummary, champList, type RadarAxis } from "@/lib/champions";
import { TfCard, TfPerf, TfStrip, TfTier, TimeframePicker } from "@/components/champion/Timeframe";
import { historyPatches } from "@/lib/champion-history";
import { matchesByPatch } from "@/lib/sample";
import { fewPlayersSpell, leading, SPELL_FOLLOWING, SPELL_MIN_GAMES } from "@/lib/card-score";
import {
  buildOrder,
  championPage,
  scoreRows,
  MIN_PAIR_PICK,
  type ItemRow,
} from "@/lib/champion-page";
import { augmentHref } from "@/lib/augments";
import ArchetypeTags from "@/components/ArchetypeTags";
import {
  championRatings,
  championTagData,
  championTags,
} from "@/lib/champion-tags";
import PlaystyleBars from "@/components/champion/PlaystyleBars";
import { pageMeta } from "@/lib/meta";
import { Name, T } from "@/components/I18n";
import {
  Cell,
  Head,
  ItemIcon,
  ItemName,
  LaterItems,
  Keys,
  Panel,
  pct,
  RatedCells,
  Row,
  signed,
  signedPts,
  tone,
} from "@/components/champion/Ranked";
import ShowMore from "@/components/champion/ShowMore";
import SimTag from "@/components/champion/SimTag";
import Quests from "@/components/champion/Quests";
import AugmentTable from "@/components/champion/AugmentTable";
import SectionRail from "@/components/champion/SectionRail";
import Fold from "@/components/champion/Fold";
import HowRankings from "@/components/HowRankings";
import { BaseStatsTable, MayhemChanges } from "@/components/champion/Details";
import {
  fillEstimated,
  fillGames,
  fillSpells,
  type SpellRow,
} from "@/lib/fill";
import { ITEM_TIERS, rewardItems, type ItemTier } from "@/lib/items";
import { championAugmentStages, championEstimates } from "@/lib/estimates";
import { bracketAugmentScores } from "@/lib/bracket-augments";
import { augmentTiers } from "@/lib/augment-tiers";
import { augmentScores, byScore, rankedAugments } from "@/lib/champion-augments";
import { SITUATIONS } from "@/lib/situations";
import StyleTabs from "@/components/champion/StyleTabs";
import { ITEM_CHANGERS, tiedWith } from "@/lib/build-plan";
import { clashWith } from "@/lib/item-limits";
import championIds from "@/data/champion-ids.json";
import augmentNames from "@/data/augment-names.json";
import descriptions from "@/data/descriptions.json";
import "../champion-page.css";
import { patchName } from "@/lib/patch-name";
import BestUpgrades from "@/components/champion/BestUpgrades";
import KitInteractions from "@/components/champion/KitInteractions";
import { kitInteractions } from "@/lib/kit-interactions";
import { championUpgrades } from "@/lib/champion-upgrades";
import { SIMULATOR_IN_STATS } from "@/lib/sim-policy";
import { augmentBuilds, buildChangers, CHANGES_BUILD } from "@/lib/augment-builds";
import AugmentBuildPicker from "@/components/champion/AugmentBuildPicker";
import { augmentSynergy } from "@/lib/augment-synergy";
import Synergies from "@/components/Synergies";
import ExpectedSwitch from "@/components/champion/ExpectedSwitch";
import { championSynergies, expectedBuilds, expectedKey, fewGames } from "@/lib/synergies";

const AUG_NAMES = augmentNames as Record<string, string>;
/** Archmage (lib/archmage-route.ts). */
const ARCHMAGE_ID = 2087;
const AUG_DESC = (descriptions as { augments: Record<string, string> }).augments;

// A typical game's estimated numbers, in this order, with how each one is written.
const PROFILE: [string, string, (v: number) => string][] = [
  ["kills", "Kills", (v) => v.toFixed(1)],
  ["deaths", "Deaths", (v) => v.toFixed(1)],
  ["assists", "Assists", (v) => v.toFixed(1)],
  ["multikills", "Multikills", (v) => v.toFixed(1)],
  [
    "damage_per_min",
    "Damage per minute",
    (v) => Math.round(v).toLocaleString("en-US"),
  ],
  [
    "taken_per_min",
    "Damage taken per minute",
    (v) => Math.round(v).toLocaleString("en-US"),
  ],
  [
    "mitigated_per_min",
    "Damage mitigated per minute",
    (v) => Math.round(v).toLocaleString("en-US"),
  ],
  [
    "heal_per_min",
    "Healing per minute",
    (v) => Math.round(v).toLocaleString("en-US"),
  ],
  [
    "gold_per_min",
    "Gold per minute",
    (v) => Math.round(v).toLocaleString("en-US"),
  ],
  ["cc_seconds", "Crowd control seconds", (v) => v.toFixed(1)],
  [
    "turret_damage",
    "Turret damage",
    (v) => Math.round(v).toLocaleString("en-US"),
  ],
  ["cs", "CS", (v) => Math.round(v).toLocaleString("en-US")],
  ["largest_spree", "Largest killing spree", (v) => v.toFixed(1)],
  // Game length is only a rough estimate, so it shows as a band, never a number.
  ["game_minutes", "Game length", () => ""],
];
const LENGTH_BAND = {
  high: "Longer than usual",
  average: "Usual length",
  low: "Shorter than usual",
};
// Simulated early, mid and late game strength (data/estimates/power_curve.json).
const STAGE_LABEL = { early: "Early game", mid: "Mid game", late: "Late game" };
const scalingNote = (s: number) =>
  s >= 0.5
    ? "Grows stronger as the game goes on."
    : s <= -0.5
      ? "Strongest early, falls off later."
      : "About as strong all game.";
const BAND = {
  high: "Above average",
  average: "Average",
  low: "Below average",
};
// How far the champion sits from the average on a performance tile: points of share, or seconds dead.
const vsAvg = (key: string, d: number) =>
  key === "dead"
    ? `${d > 0 ? "+" : ""}${Math.round(d)} s`
    : `${d > 0 ? "+" : ""}${(d * 100).toFixed(1)} pts`;

// Build lists rank by DeepScore against the champion's other builds in the same list.
// DeepScore ranks these lists; it rewards a win rate above the champion's own, so the win rate boost sits beside it.
const SCORED_COLS = ["DeepScore", "Win rate boost", "Win rate", "Pick rate"];
// With the switch on Adjusted, the default (components/champion/ExpectedSwitch.tsx), a row with few games of its own shows its
// expected win rate, leaning on the estimate (lib/synergies.ts), labelled "Expected"; the rest show "Real".
type Expected = { delta: number; expected: boolean };
function ScoredCells({ r, x }: { r: ItemRow; x?: Expected }) {
  return (
    <>
      <div className="cp-cell">
        {r.deepScore !== undefined ? (
          <DeepScore value={r.deepScore} help={BUILD_DEEPSCORE_HELP} />
        ) : (
          <b>–</b>
        )}
      </div>
      {x ? (
        <div className="cp-cell">
          <b className={`xp-real ${tone(r.lift) ?? ""}`}>{signed(r.lift)}</b>
          <b className={`xp-exp ${tone(r.lift + x.delta) ?? ""}`}>{signed(r.lift + (x.expected ? x.delta : 0))}</b>
          <small>
            <T ns={NS}>Win rate boost</T>
          </small>
        </div>
      ) : (
        <Cell value={signed(r.lift)} label="Win rate boost" tone={tone(r.lift)} />
      )}
      {x ? (
        <div className="cp-cell">
          <b className={`xp-real ${tone(r.lift) ?? ""}`}><WinRate p={r.winRate} n={r.games} /></b>
          <b className={`xp-exp ${tone(r.lift + x.delta) ?? ""}`}>{pct(r.winRate + (x.expected ? x.delta : 0))}</b>
          <small className="xp-real">
            <T ns={NS}>Win rate</T>
          </small>
          <small className={x.expected ? "xp-exp xp-tag" : "xp-exp"}>
            <T ns={NS}>{x.expected ? "Expected" : "Real"}</T>
          </small>
        </div>
      ) : (
        <Cell value={<WinRate p={r.winRate} n={r.games} />} label="Win rate" />
      )}
      <Cell value={pct(r.pickRate)} label="Pick rate" />
    </>
  );
}

// When the boots are bought in a core build: after how many core items (from game timelines, lib/champion-page.ts withBoots).
const BOOTS_WHEN: Record<number, string> = {
  0: "Boots before the 1st item",
  1: "Boots after the 1st item",
  2: "Boots after the 2nd item",
  3: "Boots after the 3rd item",
};
// Build styles from data/estimates/build_archetypes.json (the card's build tabs).
const ARCH_LABEL: Record<string, string> = { crit: "Crit", onhit: "On-hit", ap: "AP", lethality: "Lethality", fighter: "Fighter", tank: "Tank", enchanter: "Enchanter" };
const BOOTS_HELP =
  "Boots are placed where players usually buy them, unless another point clearly wins more games.";
// The slots after the core are narrow: win rate sits under the item's name, DeepScore on the right.
function LateScore({ r }: { r: ItemRow }) {
  return (
    <div className="cp-cell">
      {r.deepScore !== undefined ? (
        <DeepScore value={r.deepScore} help={ITEM_DEEPSCORE_HELP} />
      ) : (
        <b>–</b>
      )}
    </div>
  );
}

const TIER_LABEL: Record<ItemTier, string> = {
  legendary: "Legendary",
  boots: "Boots",
  epic: "Epic",
  basic: "Basic",
  starter: "Starter",
  consumable: "Consumables",
  reward: "From augments",
};

// One page per champion, so each can be found in search. Laid out like a stat site's champion page: a header
// with the headline numbers, then a summary card (best build, skill order), ranked tables in the middle and
// section links on the right. Every table runs on the live patch's numbers (lib/champion-page.ts).

export const dynamicParams = false;
export const generateStaticParams = () =>
  championAliases().map((alias) => ({ alias }));

// "Usually finished by" stays off (champion review 2026-11-24, G2): data/estimates/build.py times the feed's old 3-item
// core, not the core shown above it, and runs about 2 minutes early against real lobby timelines (1st/2nd/3rd
// legendary 2.2/5.7/9.2 min estimated vs 3.8/8.1/11.9 real median). Turn back on once it times the shown core from
// real purchase timelines.
const SHOW_ITEM_TIMING = false;
const NS = "champions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ alias: string }>;
}): Promise<Metadata> {
  const c = championSummary((await params).alias);
  if (!c) return {};
  const stats =
    c.winRate !== undefined
      ? ` ${c.tier} tier, ${pct(c.winRate)} win rate on patch ${patchName(c.patch)}.`
      : "";
  const best = rankedAugments(c.alias).slice(0, 3);
  const augs = best.length
    ? ` Best augments: ${best.map((a) => a.name).join(", ")}.`
    : "";
  const meta = pageMeta(
    `/champions/${c.alias}`,
    `${c.name} ARAM Mayhem Build & Augments`,
    `${c.name} in ARAM Mayhem:${stats}${augs}`,
  );
  if (c.splash) {
    const image = { url: c.splash, width: 1215, height: 717, alt: c.name };
    meta.openGraph = { ...meta.openGraph, images: [image] };
    meta.twitter = { ...meta.twitter, images: [c.splash] };
  }
  return meta;
}

// The section links, in page order.
// What a player checks mid-match comes first; stats and graphs follow, and More details sits last.
// One link per section, named for what a player looks for (Nico, 2026-11-20: "Builds" hid the items).
const SPOTS = [
  { id: "augments", label: "Augments" },
  { id: "combos", label: "Augment synergies" },
  { id: "builds", label: "Items" },
  { id: "spells", label: "Spells and skills" },
  { id: "teammates", label: "Teammates" },
  { id: "playstyle", label: "Playstyle" },
  { id: "performance", label: "Stats" },
  { id: "details", label: "More details" },
];

function Spells({ r }: { r: SpellRow }) {
  return (
    <span className="cp-icons">
      {r.spells.map((s) => (
        <img
          key={s.id}
          className="cp-icon"
          src={s.icon}
          alt={s.name}
          title={s.name}
          width={36}
          height={36}
          loading="lazy"
        />
      ))}
    </span>
  );
}

/** Win rate, pick rate and win rate boost, or just pick rate and games for estimated spells. */
function SpellCells({ r }: { r: SpellRow }) {
  return r.estimated ? (
    <>
      <Cell value={pct(r.pickRate)} label="Pick rate" />
      <Cell value={r.games.toLocaleString("en-US")} label="Games" />
    </>
  ) : (
    <RatedCells r={r} />
  );
}

function NotYet({ text }: { text: string }) {
  return (
    <div className="cp-empty">
      <span className="cp-ghost" aria-hidden="true">
        <span />
        <span />
      </span>
      <p>
        <b>
          <T ns={NS}>Not enough games yet.</T>
        </b>{" "}
        <T ns={NS}>{text}</T>
      </p>
    </div>
  );
}

export default async function ChampionPage({
  params,
}: {
  params: Promise<{ alias: string }>;
}) {
  const alias = (await params).alias;
  const c = championSummary(alias);
  const p = championPage(alias);
  const est = championEstimates(
    (championIds as Record<string, number>)[alias] ?? -1,
  );
  if (!c || !p) notFound();
  // Neighbours by name, for the arrows (and the [ and ] keys, lib/subtab-nav.ts).
  const all = champList();
  const at = all.findIndex((x) => x.id === c.alias);
  const prev = all[(at - 1 + all.length) % all.length];
  const next = all[(at + 1) % all.length];
  const info = p.itemInfo;
  // Simulator-made panels stay off while the Simulator is a fun tool only (lib/sim-policy.ts).
  const upgrades = SIMULATOR_IN_STATS ? championUpgrades(c.alias) : null;
  const augBuilds = SIMULATOR_IN_STATS ? augmentBuilds(c.alias) : null;
  const changers = SIMULATOR_IN_STATS ? buildChangers(c.alias) : new Set<number>();
  const bestCore = p.core[0]; // the lists rank by DeepScore, which already trusts rare builds less
  // The card's build plan for one core: the core in buying order, the rest of the usual build, the parts to rush,
  // augment swaps, then situational items (Nico, 2026-11-20). One per style tab when the champion has two real styles.
  const buildPlan = (
    core: ItemRow,
    situ: typeof p.situational,
    rush: number[],
    swaps: typeof p.augmentSwaps,
    // The card's whole build, for the "Replaces" note on situational items that share an item limit with one of it.
    owned = [...buildOrder(core), ...(core.full ?? []).map((r) => r.items[0])],
  ) => (
    <>
      <div className="cp-best cp-best-wide">
        <h4>
          <T ns={NS}>{(core.full ?? []).length ? "Full build" : "Best core build"}</T>
          {p.coreFromEarlier && (
            <>
              {" "}
              <small className="cp-stale-tag" title="From earlier games, in the order players bought them: the newest numbers only list finished builds. Shown while today's builds still use these items.">
                <T ns={NS}>From earlier games</T>
              </small>
            </>
          )}
        </h4>
        <ol className="cp-icons cp-buy-order">
          {buildOrder(core).map((id) => (
            <li key={id}>
              <ItemIcon id={id} info={info} named />
            </li>
          ))}
          {/* The full build (Nico, 2026-11-23): the core, then the best pick for each slot after it. */}
          {(core.full ?? []).map((r) => (
            <li key={r.items[0]} className="cp-full-pick">
              <ItemIcon id={r.items[0]} info={info} named />
            </li>
          ))}
        </ol>
        <BuildWhy
          why={buildWhy(c.alias, [...buildOrder(core), ...(core.full ?? []).map((r) => r.items[0])].filter((i) => i !== core.boots))}
          champion={c.name}
          championId={(championIds as Record<string, number>)[alias] ?? -1}
          items={info}
        />
        {!core.later?.length && (core.rest ?? []).length > 0 && (
          <p className="cp-rest">
            <small>
              <T ns={NS}>Then</T>
            </small>
            {core.rest!.map((id) => (
              <ItemIcon key={id} id={id} info={info} named />
            ))}
          </p>
        )}
        {rush.length > 0 && (
          <p className="cp-rush">
            <small>
              <T ns={NS}>Rush</T>
            </small>
            {rush.map((id) => (
              <ItemIcon key={id} id={id} info={info} named />
            ))}
          </p>
        )}
        {core.boots !== undefined && core.bootsAt !== undefined && (
          <p className="cp-boots-when">
            <T ns={NS}>{BOOTS_WHEN[core.bootsAt]}</T>{" "}
            <small className="cp-stale-tag" title={BOOTS_HELP}>
              <T ns={NS}>Estimated</T>
            </small>
          </p>
        )}
        <div className="cp-mini">
          <RatedCells r={core} />
        </div>
        {p.buildsEstimated && (
          <small className="cp-stale">
            <T ns={NS}>{"Few games so far: estimated from earlier games and this patch's changes."}</T>
          </small>
        )}
      </div>
      {(core.later ?? []).length > 0 && (
        <LaterItems
          rows={core.later!}
          slots={core.slots}
          inBuild={core.full}
          info={info}
          title={(core.full ?? []).length ? "Items 4 to 6" : undefined}
        />
      )}
      {(situ.length > 0 || swaps.length > 0) && (
        <div className="cp-best cp-best-wide cp-best-sit">
          <h4>
            <T ns={NS}>Situational items</T>
          </h4>
          {/* One row per trigger, read left to right (Nico, 2026-11-24: clearer options after the core): when, the
              best item for it, the runners-up, then why or which build item it replaces. Augment swaps first. */}
          <ul className="cp-sit-rows">
            {/* Augment-triggered swaps (lib/build-plan.ts augmentSwaps): rule-based tips from what each augment does. */}
            {swaps.map((sw) => {
              const clash = clashWith(sw.item, owned);
              return (
                <li key={`a${sw.item}`} className="cp-sit-row-aug">
                  <span className="cp-sit-when">
                    <img className="cp-icon round" src={`/icons/augments/${sw.augments[0]}.webp`} alt="" width={24} height={24} />
                    <T ns={NS} v={{ augment: AUG_NAMES[sw.augments[0]] ?? "" }}>
                      {"With {augment}"}
                    </T>
                  </span>
                  <span className="cp-sit-best">
                    <ItemIcon id={sw.item} info={info} named />
                  </span>
                  <span className="cp-sit-alt" />
                  <small className="cp-sit-why">
                    <T ns={NS}>{sw.why}</T>
                    {clash !== undefined && (
                      <>
                        {" "}
                        <T ns={NS}>Replaces</T> <ItemName id={clash} info={info} />
                      </>
                    )}
                  </small>
                </li>
              );
            })}
            {situ.map((st) => {
              // The game won't let you own both (lib/item-limits.ts): say which build item this one replaces.
              const clash = st.options[0] ? clashWith(st.options[0].items[0], owned) : undefined;
              const [best, ...alts] = st.options.slice(0, 3);
              return (
                <li key={st.situation}>
                  <span className="cp-sit-when">
                    <T ns={NS}>{SITUATIONS[st.situation]}</T>
                  </span>
                  <span className="cp-sit-best">{best && <ItemIcon id={best.items[0]} info={info} named />}</span>
                  <span className="cp-sit-alt">
                    {alts.length > 0 && (
                      <>
                        <small>
                          <T ns={NS}>or</T>
                        </small>
                        {alts.map((r) => (
                          <ItemIcon key={r.items[0]} id={r.items[0]} info={info} />
                        ))}
                      </>
                    )}
                  </span>
                  <small className="cp-sit-why">
                    {clash !== undefined && (
                      <>
                        <T ns={NS}>Replaces</T> <ItemName id={clash} info={info} />
                      </>
                    )}
                  </small>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </>
  );
  // Augments rank by their DeepScore on this champion, the same ranking the rest of the site uses (lib/champion-augments.ts).
  const scores = augmentScores(c.alias);
  // The augment list by skill bracket, live patch only (lib/bracket-augments.ts); null hides the bracket switch.
  const bracketMaps = bracketAugmentScores(c.alias);
  // Each augment's Tier List DeepScore across all champions, for the table's "vs all champions" marker.
  const everywhere = Object.fromEntries(augmentTiers().map((x) => [x.id, x.deepScore]));
  const bracketAugs = bracketMaps
    ? Object.fromEntries(Object.entries(bracketMaps).map(([b, m]) => [b, Object.fromEntries(m!)]))
    : null;
  // The same on the live patch's games alone, for the table's "This patch only" switch.
  const patchScores = augmentScores(c.alias, true);
  // Each augment's share of this champion's picks at the 1st to 4th augment pick (estimated).
  const pickStages = championAugmentStages(p.augments);
  const augRows = p.augments
    .map((a) => ({
      ...a,
      ...est?.augments.get(a.id),
      // Augment win rates stay off the page while Riot's policy rules them out (lib/augment-policy.ts).
      ...(SHOW_AUGMENT_WIN_RATES ? {} : { winRate: undefined }),
      // Pooled numbers feed the two scores below and stay off the page.
      pooled: undefined,
      stages: pickStages.get(a.id),
      deepScore: scores.get(a.id),
      patchScore: patchScores.get(a.id),
      href: augmentHref(a.id) ?? undefined,
      desc: AUG_DESC[String(a.id)],
      changesBuild: changers.has(a.id),
    }))
    .sort(byScore(scores));
  const synergyPairs = augmentSynergy(c.alias, augRows.map((a) => a.id));
  // Confirmed-mechanic pairs that add to each other, strongest first (the Augment synergies panel).
  const gains = synergyPairs
    .filter((r) => r.rule && (r.order ? Math.max(...r.order) : r.points) > 0)
    .sort((x, y) => (y.order ? Math.max(...y.order) : y.points) - (x.order ? Math.max(...x.order) : x.points));
  const interactions = kitInteractions(c.alias, p.augments);
  const bestStart = p.cardStart;
  // Skill orders: real level-ups ranked by DeepScore (lib/skill-orders.ts), best first.
  const bestSkill = p.skills[0] ?? null;
  // Nico's per-champion order (lib/augment-skills.ts) replaces the best order on the cards; it has no stats of its own.
  const pinnedSkill = CHAMPION_SKILLS[c.alias] ?? null;
  // Nico's split (Katarina: Q to 3, then max E), shown before the order.
  const skillSplit = CHAMPION_SPLITS[c.alias] ?? null;
  const rawSpells = fillSpells(c.alias, c.winRate ?? 0.5);
  const spellsEstimated = rawSpells.some((r) => r.estimated);
  // Spell pairs rank by DeepScore like the build lists. Estimated spells have no win rate, so they keep
  // their most-picked-first order.
  // Real spell pairs (AramHex) lead only with a real following, the same 1/4 rule as builds, so a pair a few percent
  // of players take can't top the card on win rate alone (Ghost + Barrier over Flash on Ahri).
  const spells = spellsEstimated ? rawSpells : leading(scoreRows(rawSpells, FIT.items, { bound: true }), SPELL_FOLLOWING, SPELL_MIN_GAMES);
  const bestSpells = spells[0];
  const games = fillGames()?.[c.alias];
  const gamesEstimated = fillEstimated();
  const perfOf = (axes: RadarAxis[]) => {
    const radar = new Map(axes.map((a) => [a.key, a]));
    return (
      ["win_rate", "pick_rate", "damage", "tank", "kp", "dead"] as const
    ).flatMap((k) => (radar.get(k) ? [radar.get(k)!] : []));
  };
  const perf = perfOf(c.radar);
  const expected = expectedBuilds((championIds as Record<string, number>)[alias] ?? -1);
  const synergies = championSynergies((championIds as Record<string, number>)[alias] ?? -1);
  const xp = (fam: "starting" | "boots" | "full_builds" | null, r: ItemRow) => (fam ? expected.get(expectedKey(fam, r.items)) : undefined);
  // A row holding an item only an augment hands out is hidden under Adjusted and tagged under Raw (ExpectedSwitch).
  const rewards = rewardItems();
  const augItem = (r: ItemRow) => r.items.some((id) => rewards.has(id));
  const augTag = (r: ItemRow) =>
    augItem(r) ? (
      <span className="aug-item-tag">
        <T ns={NS}>Augment item</T>
      </span>
    ) : null;
  const itemRows = (rows: typeof p.core, sep = false, fam: "starting" | "full_builds" | null = null) =>
    rows.map((r, i) => (
      <Row key={i} rank={i + 1} cols={4} className={augItem(r) ? "aug-item" : undefined} cells={<ScoredCells r={r} x={xp(fam, r)} />}>
        {buildOrder(r).map((id, j) => (
          <span key={j} className="cp-chain">
            {sep && j > 0 && (
              <span className="cp-sep" aria-hidden="true">
                ›
              </span>
            )}
            <ItemIcon id={id} info={info} />
          </span>
        ))}
        {augTag(r)}
        {r.estimated && (
          <small className="cp-stale-tag" title="From fewer games than the rest of the list">
            <T ns={NS}>Estimated</T>
          </small>
        )}
      </Row>
    ));
  const singleRows = (rows: typeof p.core, fam: "boots" | null = null) =>
    rows.map((r, i) => (
      <Row key={i} rank={i + 1} cols={4} className={augItem(r) ? "aug-item" : undefined} cells={<ScoredCells r={r} x={xp(fam, r)} />}>
        <ItemIcon id={r.items[0]} info={info} />
        <ItemName id={r.items[0]} info={info} />
        {augTag(r)}
      </Row>
    ));

  const spellsTile = (
          <div className="cp-best">
            <h4>
              <T ns={NS}>Best summoner spells</T>
            </h4>
            {bestSpells ? (
              <>
                <Spells r={bestSpells} />
                {fewPlayersSpell(bestSpells, spells) && <FewPlayers spellPickRate={bestSpells.pickRate} />}
                <small className="cp-stale-tag">
                  <T ns={NS}>Estimated</T>
                </small>
                <div className="cp-mini">
                  {bestSpells.estimated ? (
                    <Cell value={pct(bestSpells.pickRate)} label="Pick rate" />
                  ) : (
                    <RatedCells r={bestSpells} />
                  )}
                </div>
              </>
            ) : (
              <p className="cp-empty-line">
                <T ns={NS}>Not enough games yet.</T>
              </p>
            )}
          </div>
  );
  // The card's tiles for one build (Nico, 2026-11-21: everything on the card follows the build tab). Skill order and
  // spells come champion-wide from the stats, so with several builds they say they're the same for each.
  // Augments for a style: the champion's ranking, kept to those whose build tags fit the style (estimated).
  const styleAugs = (ids: number[]) => {
    const keep = new Set(ids);
    const fit = augRows.filter((a) => keep.has(a.id));
    return fit.length >= 3 ? fit : augRows;
  };
  // AP Ashe with Archmage (lib/archmage-route.ts): the haste that keeps Hawkshot and R refreshing each other, the items
  // that reach it first, then the rest of the build.
  const archmageTile = (routes: NonNullable<(typeof p.builds)[number]["archmage"]>) => (
    <div className="cp-best cp-best-wide cp-archmage">
      <h4>
        <T ns={NS} v={{ augment: (AUG_NAMES[ARCHMAGE_ID] ?? "Archmage") }}>{"With {augment}"}</T>{" "}
        <small className="cp-stale-tag">
          <T ns={NS}>Estimated</T>
        </small>
      </h4>
      <p className="cp-same-note">
        <T ns={NS}>{"Archmage makes Hawkshot and R refresh each other. Get this much Ability Haste first (R rank 3), then finish the build."}</T>
      </p>
      {routes.map((r) => (
        <div key={r.with.join("+") || "alone"} className="cp-archmage-row">
          <span className="cp-icons">
            {[ARCHMAGE_ID, ...r.with].map((a) => (
              <img key={a} className="cp-icon round" src={`/icons/augments/${a}.webp`} alt={AUG_NAMES[a] ?? ""} title={AUG_NAMES[a] ?? ""} width={28} height={28} />
            ))}
          </span>
          <span className="cp-archmage-need">
            {r.need !== null && (r.reach ? (
              <T ns={NS} v={{ haste: r.need, rank: r.eRank }}>{"{haste} Ability Haste · Hawkshot rank {rank}"}</T>
            ) : (
              <T ns={NS} v={{ haste: r.haste, need: r.need }}>{"Items reach {haste} of the {need} Ability Haste needed."}</T>
            ))}
          </span>
          <span className="cp-icons">
            {r.items.map((id, i) => (
              <span key={i} className={i > r.routeLen ? "cp-archmage-fill" : undefined}>
                <ItemIcon id={id} info={info} />
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
  const skillTile = (skill: typeof bestSkill) =>
    (skill || pinnedSkill) && (
      <div className="cp-best cp-best-skill">
        <h4>
          <T ns={NS}>Best skill order</T>
        </h4>
        {skillSplit && (
          <div className="cp-aug-skill">
            <T ns={NS} v={{ key: skillSplit.first, points: skillSplit.points }}>{"First {key} to {points} points, then:"}</T>
            {skillSplit.weak && (
              <small className="cp-stale-tag">
                <T ns={NS}>Weaker evidence</T>
              </small>
            )}
          </div>
        )}
        <Keys keys={pinnedSkill ?? skill!.max} />
        {!pinnedSkill && skill && (
          <div className="cp-mini">
            <RatedCells r={skill} />
          </div>
        )}
        {(AUGMENT_SKILLS[c.alias] ?? []).map((a) => (
          <div key={a.augment} className="cp-aug-skill">
            <img className="cp-icon round" src={`/icons/augments/${a.augment}.webp`} alt="" width={22} height={22} />
            <T ns={NS} v={{ augment: AUG_NAMES[a.augment] ?? "" }}>{"With {augment}"}</T>
            <Keys keys={a.skills} />
          </div>
        ))}
        <small className="cp-stale-tag">
          <T ns={NS}>Estimated</T>
        </small>
      </div>
    );
  const cardTiles = (
    start: ItemRow | null,
    augs: typeof augRows,
    skill: typeof bestSkill,
    plan: React.ReactNode,
    perBuild: boolean,
  ) => (
    <>
          {spellsTile}
          {start && (
            <div className="cp-best">
              <h4>
                <T ns={NS}>Starter items</T>
              </h4>
              <div className="cp-icons">
                {start.items.map((id, i) => (
                  <ItemIcon key={i} id={id} info={info} named />
                ))}
              </div>
              <div className="cp-mini">
                {Number.isFinite(start.winRate) && <RatedCells r={start} />}
                {(!Number.isFinite(start.winRate) || start.estimated) && <small className="cp-stale-tag"><T ns={NS}>Estimated</T></small>}
              </div>
            </div>
          )}
          {augs.length > 0 && (
            <div className="cp-best cp-best-wide cp-best-augs">
              <h4>
                <T>Best augments</T>
                {perBuild && (
                  <>
                    {" "}
                    <small className="cp-stale-tag" title="Augments whose build tags fit this build: estimated.">
                      <T ns={NS}>Estimated</T>
                    </small>
                  </>
                )}
              </h4>
              {/* The best on this champion whatever their rarity; the icon's ring shows the rarity. */}
              <span className="cp-icons">
                {augs.slice(0, 6).map((a) => (
                  <RowLink key={a.id} href={a.href ?? "#augments"} title={a.name} className={`cp-named rarity-${a.rarity}`}>
                    <img className="cp-icon round" src={`/icons/augments/${a.id}.webp`} alt={a.name} width={40} height={40} />
                    <small aria-hidden="true">
                      <Name kind="augments" id={a.id}>
                        {a.name}
                      </Name>
                    </small>
                  </RowLink>
                ))}
              </span>
            </div>
          )}
          {skillTile(skill)}
          {plan}
      {perBuild && (
        <p className="cp-same-note">
          <T ns={NS}>{"Summoner spells are the same for every build: the stats don't split them by build."}</T>
        </p>
      )}
    </>
  );
  // The glance row follows the card's default build (the first tab: best DeepScore).
  const glanceCore = p.builds[0]?.core ?? bestCore;
  const glanceSkill = p.builds[0]?.skills[0] ?? bestSkill;
  const glanceAugs = p.builds.length > 1 ? styleAugs(p.builds[0].augments) : augRows;
  const matches = matchesByPatch();

  return (
    <>
      <Breadcrumbs
        trail={[
          ["Champions", "/champions"],
          [c.name, `/champions/${c.alias}`],
        ]}
      />
      {/* The colour sample only needs a few pixels, so it reads the small tile when there is one. */}
      <SplashAccent src={c.splashSmall ?? c.splash} />
      <section
        className="champ-hero cp-hero"
        style={
          c.splash
            ? ({
                "--splash": `url("${c.splash}")`,
                // Phones get the small tile: the full splash was a quarter of the page's weight (site idea 2026-11-05).
                ...(c.splashSmall ? { "--splash-small": `url("${c.splashSmall}")` } : {}),
              } as React.CSSProperties)
            : undefined
        }
      >
        <nav className="champ-steps" aria-label="Other champions">
          <Link href={`/champions/${prev.id}`} data-swipe="prev" rel="prev">
            ‹{" "}
            <Name kind="champions" id={prev.id}>
              {prev.name}
            </Name>
          </Link>
          <span className="eyebrow">
            <Link href="/tier-list">
              <T>Tier List</T>
            </Link>{" "}
            ·{" "}
            <T ns={NS} v={{ v: patchName(c.patch) }}>
              {"Patch {v}"}
            </T>
          </span>
          <Link href={`/champions/${next.id}`} data-swipe="next" rel="next">
            <Name kind="champions" id={next.id}>
              {next.name}
            </Name>{" "}
            ›
          </Link>
        </nav>
        <div className="cp-title">
          <img
            className="champ-hero-icon"
            src={`/icons/champions/${c.alias}.webp`}
            alt=""
            width={80}
            height={80}
          />
          <div>
            <h1>
              <Name kind="champions" id={c.alias}>
                {c.name}
              </Name>{" "}
              <span className="champ-hero-sub">
                <T ns={NS}>ARAM Mayhem build</T>
              </span>
            </h1>
            {c.title && (
              <p className="cp-sub">
                <Name kind="titles" id={c.alias}>
                  {c.title.charAt(0).toUpperCase() + c.title.slice(1)}
                </Name>
              </p>
            )}
          </div>
          {c.tier && (
            <TfTier alias={c.alias} patches={c.patches} matches={matches}>
              <span className={`cp-tier chip tier-${c.tier.toLowerCase()}`} title="Tier">
                {c.tier}
              </span>
            </TfTier>
          )}
        </div>
        {c.winRate !== undefined && (
          <TfStrip alias={c.alias} patches={c.patches} matches={matches}>
                <div className="cp-strip">
                <Cell
                  value={<WinRate p={c.winRate} n={c.games} />}
                  label="Win rate"
                  tone={
                    c.winRate >= 0.52
                      ? "up"
                      : c.winRate <= 0.48
                        ? "down"
                        : undefined
                  }
                />
                {c.change !== null && (
                  <div className="cp-cell">
                    <b className={tone(c.change)}>{signed(c.change)}</b>
                    <small>
                      <T ns={NS} v={{ patch: patchName(c.prev) }}>
                        {"since {patch}"}
                      </T>
                    </small>
                  </div>
                )}
                <Cell value={pct(c.pickRate ?? 0)} label="Pick rate" />
                {games !== undefined && (
                  <Cell
                    value={`${gamesEstimated ? "~" : ""}${games.toLocaleString("en-US")}`}
                    label="Games"
                  />
                )}
                <div className="cp-cell">
                  <b>#{c.rank}</b>
                  <small>
                    <T ns={NS} v={{ n: c.of }}>
                      {"of {n} by DeepScore"}
                    </T>
                  </small>
                </div>
              </div>
          </TfStrip>
        )}
        {(() => {
          const br = championBrackets(c.alias, c.patch);
          return br ? <BracketRates rates={br.rates} borrowed={br.patch !== c.patch ? br.patch : null} /> : null;
        })()}
        {/* One glance: the core, the best augments and the skill order; the card below has the detail. */}
        {(glanceCore || augRows.length > 0 || glanceSkill || pinnedSkill) && (
          <a className="cp-glance" href="#build" aria-label="Build at a glance">
            {glanceCore && (
              <span className="cp-glance-part">
                {buildOrder(glanceCore).map((id) => (
                  <ItemIcon key={id} id={id} info={info} />
                ))}
              </span>
            )}
            {glanceAugs.length > 0 && (
              <span className="cp-glance-part">
                {glanceAugs.slice(0, 3).map((a) => (
                  <img key={a.id} className={`cp-icon round rarity-${a.rarity}`} src={`/icons/augments/${a.id}.webp`} alt={a.name} title={a.name} width={28} height={28} />
                ))}
              </span>
            )}
            {(pinnedSkill || glanceSkill) && (
              <span className="cp-glance-part">
                <Keys keys={pinnedSkill ?? glanceSkill!.max} />
              </span>
            )}
          </a>
        )}
        <TimeframePicker patches={c.patches} buildPatches={historyPatches()} />
      </section>

      {/* Game card: everything needed for a game on one screen, in the order it comes up from champion select to
          late game (Nico, 2026-11-20). The taken-augments row (drag to replace) is planned to sit at its end. */}
      <TfCard alias={c.alias} patches={c.patches} matches={matches} spells={spellsTile} skill={skillTile(glanceSkill)}>
      <section className="cp-game" id="build" aria-label="Build for your game">
          {p.builds.length > 1 ? (
            <StyleTabs
              whole
              tabs={p.builds.map((b) => ({
                key: b.style,
                label: ARCH_LABEL[b.style] ?? b.style,
                share: `${pct(b.share)} · DeepScore ${b.deepScore}`,
                panel: cardTiles(
                  b.start,
                  styleAugs(b.augments),
                  b.skills[0] ?? bestSkill,
                  <>
                    {buildPlan(b.core, b.situational, b.rush, b.augmentSwaps)}
                    {b.archmage && archmageTile(b.archmage)}
                  </>,
                  true,
                ),
              }))}
            />
          ) : (
            cardTiles(bestStart, augRows, glanceSkill, bestCore && buildPlan(bestCore, p.situational, p.rush, p.augmentSwaps), false)
          )}
      </section>
      </TfCard>

      <div className="cp">

        <div className="cp-main">
          <HowRankings />
          <h2 className="cp-group" id="augments">
            <T ns={NS}>Augments</T>
          </h2>
          {p.augments.length > 0 && (
            <Panel
              title="Augments"
              count={p.augments.length}
              note={
                est?.augments.size ? (
                  SHOW_AUGMENT_WIN_RATES ? (
                    <T ns={NS}>
                      {
                        "Win rates are estimated. The boost below each is how much the augment adds to this champion's win rate."
                      }
                    </T>
                  ) : (
                    <T ns={NS}>{"Boost is estimated: how many points of win rate the augment adds to this champion."}</T>
                  )
                ) : undefined
              }
            >
              <AugmentTable rows={augRows} champion={c.alias} synergy={synergyPairs} patch={patchName(c.patch)} brackets={bracketAugs ?? undefined} everywhere={everywhere} />
            </Panel>
          )}
          {/* Augment synergies (Nico, 2026-11-20): pairs worth more than the sum of their parts, from confirmed
              mechanics only (augment_synergy_rules.json). Pairs of two augments that are simply strong on their own
              aren't listed, and nothing here comes from the Simulator. */}
          {gains.length ? (
            <Panel
              id="combos"
              title="Augment synergies"
              count={gains.length}
              note={<T ns={NS}>{"Augments that make each other stronger on this champion: worth more together than apart."}</T>}
            >
              <ShowMore total={gains.length} limit={5}>
                {gains.map((r, i) => (
                  <Row key={`${r.a}-${r.b}`} rank={i + 1} cols={1} cells={null}>
                    <span className="cp-pair">
                      {[r.a, r.b].map((id) => (
                        <span key={id} className="cp-pair-one">
                          <img className="cp-icon round" src={`/icons/augments/${id}.webp`} alt="" width={32} height={32} loading="lazy" />
                          <span className="cp-name">
                            <Name kind="augments" id={id}>
                              {AUG_NAMES[id] ?? ""}
                            </Name>
                          </span>
                        </span>
                      ))}
                    </span>
                    {r.why && (
                      <small className="cp-pair-why">
                        {r.why}
                      </small>
                    )}
                  </Row>
                ))}
              </ShowMore>
            </Panel>
          ) : (
            <Panel id="combos" title="Augment synergies">
              <NotYet text="No confirmed augment synergies for this champion yet." />
            </Panel>
          )}
          {interactions.length > 0 && <KitInteractions rows={interactions} />}
          {upgrades && <BestUpgrades u={upgrades} />}

          <h2 className="cp-group" id="builds">
            <T ns={NS}>Items</T>
          </h2>
          {expected.size > 0 && <ExpectedSwitch />}
          {augBuilds && (
            <Panel
              id="augment-builds"
              title="Build for your augments"
              note={
                <>
                  <T ns={NS}>
                    {"The builds below are for any augments. Pick yours to see the best items with it."}
                  </T>{" "}
                  <SimTag title="Simulated: the Simulator's best items with this augment taken, compared with its best items with no augment." />
                </>
              }
            >
              <AugmentBuildPicker
                data={augBuilds}
                names={Object.fromEntries(augBuilds.builds.flatMap((b) => b.augments).map((id) => [id, AUG_NAMES[id] ?? ""]))}
                changes={CHANGES_BUILD}
              />
            </Panel>
          )}
          {p.core.length > 0 && (
            <Panel
              title="Core item builds"
              count={p.core.length}
              note={
                p.buildsEstimated ? (
                  <T ns={NS}>{"Few games so far: estimated from earlier games and this patch's changes."}</T>
                ) : p.coreDerived ? (
                  <T ns={NS}>From the most common full builds, most built items first.</T>
                ) : undefined
              }
            >
              <Head what="Core items" cols={SCORED_COLS} />
              <ShowMore total={p.core.length} limit={5}>
                {itemRows(p.core, true)}
              </ShowMore>
              {p.core.some((r) => r.bootsAt !== undefined) && (
                <p className="cp-boots-when cp-boots-note">
                  <T ns={NS}>Boots are shown where to buy them.</T>{" "}
                  <small className="cp-stale-tag" title={BOOTS_HELP}>
                    <T ns={NS}>Estimated</T>
                  </small>
                </p>
              )}
              {SHOW_ITEM_TIMING && est && est.timing.length > 0 && (
                <div className="cp-timing">
                  <small>
                    <T ns={NS}>Usually finished by</T>
                  </small>
                  {est.timing.map((t, i) => (
                    <span key={i} className="cp-chain">
                      {i > 0 && (
                        <span className="cp-sep" aria-hidden="true">
                          ›
                        </span>
                      )}
                      <ItemIcon id={t.id} info={info} />
                      <T ns={NS} v={{ n: Math.max(1, Math.round(t.minute)) }}>
                        {"{n} min"}
                      </T>
                    </span>
                  ))}
                  <em>
                    <T ns={NS}>Estimated</T>
                  </em>
                </div>
              )}
            </Panel>
          )}
          {p.situational.length > 0 && (
            <Panel
              title="Situational items"
              note={
                <T ns={NS}>
                  {
                    "After the core, swap in what the game calls for. Each situation comes from the item's own effect; best DeepScore at the top."
                  }
                </T>
              }
            >
              <div className="cp-late">
                {p.situational.map((s) => (
                  <div key={s.situation}>
                    <h4>
                      <T ns={NS}>{SITUATIONS[s.situation]}</T>
                    </h4>
                    {s.options.map((r, i) => (
                      <Row
                        key={i}
                        rank={i + 1}
                        cols={1}
                        cells={<LateScore r={r} />}
                      >
                        <ItemIcon id={r.items[0]} info={info} />
                        <span className="cp-late-what">
                          <ItemName id={r.items[0]} info={info} />
                          {i > 0 && tiedWith(s.options[0], r) && (
                            <small className="cp-tied" title="Within noise of the top pick: either is fine.">
                              <T ns={NS}>Tied</T>
                            </small>
                          )}
                          <small className={tone(r.lift)}>
                            <T ns={NS} v={{ n: signedPts(r.lift) }}>
                              {"{n} pts boost"}
                            </T>
                            {" · "}
                            <Sampled n={r.games} p={r.winRate}>
                              <T ns={NS} v={{ n: pct(r.winRate) }}>
                                {"{n} win rate"}
                              </T>
                            </Sampled>
                          </small>
                        </span>
                      </Row>
                    ))}
                  </div>
                ))}
              </div>
            </Panel>
          )}
          <div className="cp-two">
            {p.starting.length > 0 && (
              <Panel title="Starter items" count={p.starting.length}>
                <Head what="Starter items" cols={SCORED_COLS} />
                <ShowMore total={p.starting.length} limit={5}>
                  {itemRows(p.starting, false, "starting")}
                </ShowMore>
              </Panel>
            )}
            {p.boots.length > 0 && (
              <Panel title="Boots" count={p.boots.length}>
                <Head what="Boots" cols={SCORED_COLS} />
                <ShowMore total={p.boots.length} limit={5}>
                  {singleRows(p.boots, "boots")}
                </ShowMore>
              </Panel>
            )}
          </div>
          {p.full.length > 0 && (
            <Panel
              title="Full builds"
              count={p.full.length}
              detailed
              note={p.buildsEstimated ? <T ns={NS}>{"Few games so far: estimated from earlier games and this patch's changes."}</T> : undefined}
            >
              <Head what="Six items" cols={SCORED_COLS} />
              <ShowMore total={p.full.length} limit={5}>
                {itemRows(p.full, false, "full_builds")}
              </ShowMore>
            </Panel>
          )}
          {p.items.length > 0 && (
            <Fold titles={["All items"]}>
              <Panel
                title="All items"
                count={p.items.length}
                note={
                  <T ns={NS}>
                    {
                      "Grouped by tier, best DeepScore first in each, with each item's pick rate and win rate."
                    }
                  </T>
                }
              >
                {ITEM_TIERS.map((tier) => {
                  // Legendaries that score above the card's weakest full-build pick but that few players build
                  // (under a quarter of the most built one): say why they aren't in the build (Nico 2026-11-23).
                  const legend = p.items.filter((r) => (r.tier ?? "legendary") === "legendary");
                  const topPick = Math.max(0, ...legend.map((r) => r.pickRate));
                  const fullFloor = Math.min(...(p.core[0]?.full ?? []).map((r) => r.deepScore ?? 0));
                  const fewPlayers = (r: ItemRow) =>
                    tier === "legendary" && r.pickRate < 0.25 * topPick && (r.deepScore ?? 0) > fullFloor;
                  const list = p.items.filter(
                    (r) => (r.tier ?? "legendary") === tier,
                  );
                  if (!list.length) return null;
                  return (
                    <section
                      key={tier}
                      className="cp-itier"
                      aria-label={TIER_LABEL[tier]}
                    >
                      <h4 className="cp-itier-h">
                        <T ns={NS}>{TIER_LABEL[tier]}</T>{" "}
                        <span>{list.length}</span>
                      </h4>
                      <div className="cp-strip-x" role="list">
                        {list.map((r) => (
                          <div
                            key={r.items[0]}
                            className="cp-tile"
                            role="listitem"
                          >
                            <ItemIcon id={r.items[0]} info={info} />
                            <ItemName id={r.items[0]} info={info} />
                            {fewPlayers(r) && (
                              <FewPlayers augment={(() => {
                                const c = ITEM_CHANGERS.find((x) => x.item === r.items[0] && p.augments.some((a) => x.ids.includes(a.id)));
                                const id = c && p.augments.find((a) => c.ids.includes(a.id))?.id;
                                return id ? AUG_NAMES[id] : undefined;
                              })()} />
                            )}
                            {r.deepScore !== undefined && (
                              <DeepScore
                                value={r.deepScore}
                                help={ITEM_DEEPSCORE_HELP}
                              />
                            )}
                            <Cell value={signed(r.lift)} label="Win rate boost" tone={tone(r.lift)} />
                            <Cell value={<WinRate p={r.winRate} n={r.games} />} label="Win rate" />
                            <Cell value={pct(r.pickRate)} label="Pick rate" />
                          </div>
                        ))}
                      </div>
                    </section>
                  );
                })}
              </Panel>
            </Fold>
          )}

          {synergies.length > 0 && (
            <>
              {/* It repeats the item lists above as points over the usual pick, so Simple view folds it. It sits at the end
                  of Items, with no heading of its own (Nico, 2026-11-24: cut bloat). */}
              <Fold section="synergies" titles={["What fits this champion"]}>
              <Panel
                id="synergies"
                title="What fits this champion"
                note={<T ns={NS}>{"Score: points of win rate over the usual choice. Choices with few games lean on the estimate."}</T>}
              >
                <Synergies tabs={synergies} few={fewGames()} subject={{ kind: "champions", id: c.alias, name: c.name }} />
              </Panel>
              </Fold>
            </>
          )}

          <h2 className="cp-group" id="spells">
            <T ns={NS}>Spells and skills</T>
          </h2>
          <Panel
            title="Summoner spells"
            count={spells.length || undefined}
            note={rawSpells.length ? <T ns={NS}>Estimated</T> : undefined}
          >
            {spells.length ? (
              <>
                <Head
                  what="Spells"
                  cols={spellsEstimated ? ["Pick rate", "Games"] : undefined}
                />
                <ShowMore total={spells.length} limit={5}>
                  {spells.map((r, i) => (
                    <Row
                      key={i}
                      rank={i + 1}
                      cols={spellsEstimated ? 2 : 3}
                      cells={<SpellCells r={r} />}
                    >
                      <Spells r={r} />
                      {fewPlayersSpell(r, spells) && <FewPlayers spellPickRate={r.pickRate} />}
                    </Row>
                  ))}
                </ShowMore>
              </>
            ) : (
              <NotYet text="Spell pairs with win rate, pick rate and win rate boost appear here once enough games are in." />
            )}
          </Panel>
          {p.skills.length > 0 && (
            <Panel
              title="Skill order"
              count={p.skills.length}
              note={
                <>
                  <T ns={NS}>
                    Max order, then the most common level-by-level order.
                  </T>
                  {" "}
                  <T ns={NS}>Estimated</T>
                </>
              }
            >
              <Head what="Max order" />
              <ShowMore total={p.skills.length} limit={5}>
                {p.skills.map((s, i) => (
                  <Row key={i} rank={i + 1} cells={<RatedCells r={s} />}>
                    <Keys keys={s.max} />
                    {i > 0 && tiedWith(p.skills[0], s) && (
                      <small className="cp-tied" title="Within noise of the top pick: either is fine.">
                        <T ns={NS}>Tied</T>
                      </small>
                    )}
                    {s.levels.length > 0 && (
                      <span
                        className="cp-levels"
                        aria-label={s.levels.join(" ")}
                      >
                        {s.levels.map((k, j) => (
                          <span key={j} data-k={k}>
                            {k}
                          </span>
                        ))}
                      </span>
                    )}
                  </Row>
                ))}
              </ShowMore>
            </Panel>
          )}

          <h2 className="cp-group" id="teammates">
            <T ns={NS}>Teammates</T>
          </h2>
          {p.mates.length > 0 ? (
            <Panel
              id="mates"
              title="Best teammates"
              count={p.mates.length}
              note={
                <T ns="tables">
                  {
                    "How much more the pair wins than the two champions' own win rates predict, in percentage points. Above zero means they help each other. Rarely played pairs count for less, so a lucky streak can't top the list."
                  }
                </T>
              }
            >
              <Head what="Teammate" cols={["Win rate boost", "Pick rate"]} />
              <ShowMore total={p.mates.length}>
                {p.mates.map((m, i) => (
                  <Row
                    key={m.id}
                    rank={i + 1}
                    cells={
                      <>
                        <Cell
                          value={<Sampled n={m.games}>{signed(m.synergy)}</Sampled>}
                          label="Win rate boost"
                          tone={tone(m.synergy)}
                        />
                        <Cell value={pct(m.pickRate)} label="Pick rate" />
                      </>
                    }
                  >
                    <RowLink className="cp-link" href={`/champions/${m.id}`}>
                      <img
                        className="cp-icon"
                        src={`/icons/champions/${m.id}.webp`}
                        alt=""
                        width={36}
                        height={36}
                        loading="lazy"
                      />
                      <span className="cp-name">
                        <Name kind="champions" id={m.id}>
                          {all.find((x) => x.id === m.id)?.name ?? m.id}
                        </Name>
                      </span>
                      {/* Neither champion has hard crowd control (lib/cc.ts). */}
                      {m.noCC && (
                        <span className="cp-pill cp-tag">
                          <T ns={NS}>No hard CC</T>
                        </span>
                      )}
                    </RowLink>
                  </Row>
                ))}
              </ShowMore>
            </Panel>
          ) : (
            <Panel title="Best teammates">
              <p className="cp-empty-line">
                <T ns={NS} v={{ n: `${(MIN_PAIR_PICK * 100).toFixed(1)}%` }}>
                  {
                    "No pair with this champion shows up in at least {n} of games yet."
                  }
                </T>
              </p>
            </Panel>
          )}
          <Quests
            alias={alias}
            names={Object.fromEntries(all.map((x) => [x.id, x.name]))}
          />

          <h2 className="cp-group" id="playstyle">
            <T ns={NS}>Playstyle</T>
          </h2>
          {/* Tags and the 3D model moved here from the header, so the top of the page is only what a game needs
              (Nico, 2026-11-20). */}
          <div className="cp-style-top">
            <ArchetypeTags names={championTags(c.alias)} info={championTagData().info} link />
            {championRatings(c.alias) && (
              <div className="cp-bars">
                <PlaystyleBars ratings={championRatings(c.alias)!} />
              </div>
            )}
            <div className="cp-model">
              <ChampionShowcase alias={c.alias} name={c.name} />
            </div>
          </div>
          <h2 className="cp-group" id="performance">
            <T ns={NS}>Stats</T>
          </h2>
          {perf.length > 0 && (
            <TfPerf alias={c.alias} patches={c.patches} matches={matches}>
              <div className="cp-perf">
                {perf.map((a) => (
                  <div key={a.key}>
                    <small>
                      <T ns={NS}>{a.label}</T>
                    </small>
                    <b>{a.value.replace(/ dead$/, "")}</b>
                    <span>
                      #{a.rank}{" "}
                      <T ns={NS} v={{ n: a.of }}>
                        {"of {n}"}
                      </T>
                    </span>
                    {est?.vsAverage.has(a.key) && (
                      <em>
                        <T ns={NS} v={{ n: vsAvg(a.key, est.vsAverage.get(a.key)!) }}>
                          {"{n} vs average"}
                        </T>
                      </em>
                    )}
                  </div>
                ))}
              </div>
            </TfPerf>
          )}
          {est && (est.profile.length > 0 || est.curve) && (
            <Fold
              section="performance"
              titles={[
                ...(est.profile.length > 0 ? ["Typical game"] : []),
                ...(est.curve ? ["Early, mid and late game"] : []),
              ]}
            >
              {est.profile.length > 0 && (
                <Panel
                  title="Typical game"
                  note={<T ns={NS}>Estimated averages per game.</T>}
                >
                  <div className="cp-profile">
                    {PROFILE.map(([key, label, fmt]) => {
                      const s = est.profile.find((x) => x.key === key);
                      if (!s) return null;
                      const rough = key === "game_minutes";
                      return (
                        <div key={key} data-band={s.band}>
                          <small>
                            <T ns={NS}>{label}</T>
                          </small>
                          <b className={rough ? "cp-words" : undefined}>
                            {rough ? (
                              <T ns={NS}>{LENGTH_BAND[s.band]}</T>
                            ) : (
                              fmt(s.value)
                            )}
                          </b>
                          <span>
                            <T ns={NS}>
                              {rough ? "Rough estimate" : BAND[s.band]}
                            </T>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {est.split && (
                    <div className="cp-split">
                      <small>
                        <T ns={NS}>Damage type</T>
                      </small>
                      <div className="cp-split-bar" aria-hidden="true">
                        {(["physical", "magic", "true"] as const).map((k) => (
                          <span
                            key={k}
                            data-k={k}
                            style={{ flexGrow: est.split![k] }}
                          />
                        ))}
                      </div>
                      <ul>
                        {(
                          [
                            ["physical", "Physical"],
                            ["magic", "Magic"],
                            ["true", "True"],
                          ] as const
                        ).map(([k, l]) => (
                          <li key={k} data-k={k}>
                            <T ns={NS}>{l}</T> {pct(est.split![k])}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </Panel>
              )}
              {SIMULATOR_IN_STATS && est.curve && (
                <Panel
                  title="Early, mid and late game"
                  note={
                    <T ns={NS}>
                      {
                        "Simulated: the champion's best build fighting a dummy at each point, compared with every other champion."
                      }
                    </T>
                  }
                >
                  <div className="cp-curve">
                    {est.curve.stages.map((st) => (
                      <div key={st.key}>
                        <small>
                          <T ns={NS}>{STAGE_LABEL[st.key]}</T>
                        </small>
                        <span className="cp-curve-bar" aria-hidden="true">
                          <span
                            style={{ width: `${Math.max(2, st.rank * 100)}%` }}
                          />
                        </span>
                        <b>
                          <T ns={NS} v={{ n: Math.round(st.rank * 100) }}>
                            {"Beats {n}%"}
                          </T>
                        </b>
                        <span>
                          <T ns={NS} v={{ level: st.level, items: st.items }}>
                            {"Level {level}, {items} items"}
                          </T>
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="cp-curve-note">
                    <T ns={NS}>{scalingNote(est.curve.scaling)}</T>
                    {est.curve.topEarly && (
                      <>
                        {" "}
                        <T ns={NS}>One of the 10 strongest early champions.</T>
                      </>
                    )}
                    {est.curve.topLate && (
                      <>
                        {" "}
                        <T ns={NS}>One of the 10 strongest late champions.</T>
                      </>
                    )}
                  </p>
                </Panel>
              )}
            </Fold>
          )}
          <WinRateChart
            id={c.alias}
            name={c.name}
            history={c.history}
            patches={c.patches}
            champions={champList()}
          />

          <h2 className="cp-group" id="details">
            <T ns={NS}>More details</T>
          </h2>
          {p.styles.length > 0 && (
            <Panel title="Builds by style" count={p.styles.length} detailed>
              <Head
                what="Style"
                cols={["Win rate", "Build share", "Win rate boost"]}
              />
              <div className="cp-rows">
                {p.styles.map((s, i) => (
                  <Row
                    key={s.label}
                    rank={i + 1}
                    cells={
                      <>
                        <Cell value={<WinRate p={s.winRate} n={s.games} />} label="Win rate" />
                        <Cell value={pct(s.share)} label="Build share" />
                        <Cell
                          value={signed(s.lift)}
                          label="Win rate boost"
                          tone={tone(s.lift)}
                        />
                      </>
                    }
                  >
                    <span className="cp-name">
                      <T ns={NS}>{s.label}</T>
                    </span>
                  </Row>
                ))}
              </div>
            </Panel>
          )}
          <MayhemChanges
            alias={c.alias}
            name={c.name}
            changes={p.changes}
            modifiers={p.modifiers}
          />
          {p.stats && (
            <Fold section="details" titles={["Base stats"]}>
              <BaseStatsTable stats={p.stats} />
            </Fold>
          )}
        </div>

        <SectionRail spots={SPOTS} />
      </div>
    </>
  );
}
