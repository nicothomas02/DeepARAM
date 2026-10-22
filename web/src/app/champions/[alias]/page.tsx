/* eslint-disable @next/next/no-img-element -- small local icons */
import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/JsonLd";
import Link from "next/link";
import SplashAccent from "@/components/SplashAccent";
import WinRateChart from "@/components/WinRateChart";
import { augmentTiers } from "@/lib/augment-tiers";
import DeepScore from "@/components/DeepScore";
import { BUILD_DEEPSCORE_HELP, ITEM_DEEPSCORE_HELP } from "@/lib/deepscore";
import ChampionShowcase from "@/components/ChampionShowcase";
import { notFound } from "next/navigation";
import { championAliases, championSummary, champList } from "@/lib/champions";
import {
  bestRow,
  championPage,
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
  Keys,
  Panel,
  pct,
  RatedCells,
  Row,
  signed,
  tone,
} from "@/components/champion/Ranked";
import ShowMore from "@/components/champion/ShowMore";
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
import { ITEM_TIERS, type ItemTier } from "@/lib/items";
import { championAugmentStages, championEstimates } from "@/lib/estimates";
import championIds from "@/data/champion-ids.json";
import augmentNames from "@/data/augment-names.json";
import "../champion-page.css";
import { patchName } from "@/lib/patch-name";

const AUG_NAMES = augmentNames as Record<string, string>;

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
const SCORED_COLS = ["DeepScore", "Win rate", "Pick rate"];
function ScoredCells({ r }: { r: ItemRow }) {
  return (
    <>
      <div className="cp-cell">
        {r.deepScore !== undefined ? (
          <DeepScore value={r.deepScore} help={BUILD_DEEPSCORE_HELP} />
        ) : (
          <b>–</b>
        )}
      </div>
      <Cell value={pct(r.winRate)} label="Win rate" tone={tone(r.lift)} />
      <Cell value={pct(r.pickRate)} label="Pick rate" />
    </>
  );
}

const SLOT_LABEL: Record<number, string> = {
  4: "4th item",
  5: "5th item",
  6: "6th item",
};
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
  const augs = c.augments.length
    ? ` Best augments: ${c.augments.map((a) => a.name).join(", ")}.`
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
// What a player checks mid-match comes first; stats and graphs sit at the bottom.
const SPOTS = [
  { id: "augments", label: "Augments" },
  { id: "combos", label: "Augment combinations" },
  { id: "builds", label: "Builds" },
  { id: "playstyle", label: "Playstyle" },
  { id: "teammates", label: "Teammates" },
  { id: "details", label: "More details" },
  { id: "performance", label: "Performance" },
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
  const bestCore = p.core[0]; // the lists rank by DeepScore, which already trusts rare builds less
  // Augments rank by their DeepScore, the same rating the Tier List uses.
  const scores = new Map(augmentTiers().map((a) => [a.id, a.deepScore]));
  // Each augment's share of this champion's picks at the 1st to 4th augment pick (estimated).
  const pickStages = championAugmentStages(p.augments);
  const augRows = p.augments
    .map((a) => ({
      ...a,
      ...est?.augments.get(a.id),
      stages: pickStages.get(a.id),
      deepScore: scores.get(a.id),
      href: augmentHref(a.id) ?? undefined,
    }))
    .sort(
      (x, y) =>
        (y.deepScore ?? -1) - (x.deepScore ?? -1) || y.pickRate - x.pickRate,
    );
  const bestStart = p.starting[0];
  const bestSkill = bestRow(p.skills, 0.1);
  const spells = fillSpells(c.alias, c.winRate ?? 0.5);
  const spellsEstimated = spells.some((r) => r.estimated);
  // Estimated spells have no win rate, so the best pick is simply the most common one.
  const bestSpells = spellsEstimated
    ? spells[0]
    : (bestRow(spells.filter((r) => r.pickRate >= 0.05)) ?? spells[0]);
  const games = fillGames()?.[c.alias];
  const gamesEstimated = fillEstimated();
  const radar = new Map(c.radar.map((a) => [a.key, a]));
  const perf = (
    ["win_rate", "pick_rate", "damage", "tank", "kp", "dead"] as const
  ).flatMap((k) => (radar.get(k) ? [radar.get(k)!] : []));
  const itemRows = (rows: typeof p.core, sep = false) =>
    rows.map((r, i) => (
      <Row key={i} rank={i + 1} cells={<ScoredCells r={r} />}>
        {(r.boots ? [r.boots, ...r.items] : r.items).map((id, j) => (
          <span key={j} className="cp-chain">
            {sep && j > 0 && (
              <span className="cp-sep" aria-hidden="true">
                ›
              </span>
            )}
            <ItemIcon id={id} info={info} />
          </span>
        ))}
      </Row>
    ));
  const singleRows = (rows: typeof p.core) =>
    rows.map((r, i) => (
      <Row key={i} rank={i + 1} cells={<ScoredCells r={r} />}>
        <ItemIcon id={r.items[0]} info={info} />
        <ItemName id={r.items[0]} info={info} />
      </Row>
    ));

  return (
    <>
      <Breadcrumbs
        trail={[
          ["Champions", "/champions"],
          [c.name, `/champions/${c.alias}`],
        ]}
      />
      <SplashAccent src={c.splash} />
      <section
        className="champ-hero cp-hero"
        style={
          c.splash
            ? ({ "--splash": `url("${c.splash}")` } as React.CSSProperties)
            : undefined
        }
      >
        <ChampionShowcase alias={c.alias} name={c.name} />
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
                {c.title.charAt(0).toUpperCase() + c.title.slice(1)}
              </p>
            )}
            <ArchetypeTags
              names={championTags(c.alias)}
              info={championTagData().info}
              link
            />
            {championRatings(c.alias) && (
              <PlaystyleBars ratings={championRatings(c.alias)!} />
            )}
          </div>
          {c.tier && (
            <span
              className={`cp-tier chip tier-${c.tier.toLowerCase()}`}
              title="Tier"
            >
              {c.tier}
            </span>
          )}
        </div>
        {c.winRate !== undefined && (
          <div className="cp-strip">
            <Cell
              value={pct(c.winRate)}
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
        )}
      </section>

      <div className="cp">
        <aside className="cp-side" aria-label="Best picks">
          {augRows.length > 0 && (
            <div className="cp-best">
              <h4>
                <T>Best augments</T>
              </h4>
              <div className="cp-icons">
                {augRows.slice(0, 5).map((a) => (
                  <Link key={a.id} href={a.href ?? "#augments"} title={a.name}>
                    <img
                      className="cp-icon round"
                      src={`/icons/augments/${a.id}.webp`}
                      alt={a.name}
                      width={36}
                      height={36}
                    />
                  </Link>
                ))}
              </div>
            </div>
          )}
          {bestStart && (
            <div className="cp-best">
              <h4>
                <T ns={NS}>Starter items</T>
              </h4>
              <div className="cp-icons">
                {bestStart.items.map((id, i) => (
                  <ItemIcon key={i} id={id} info={info} />
                ))}
              </div>
              <div className="cp-mini">
                <RatedCells r={bestStart} />
              </div>
            </div>
          )}
          <div className="cp-best">
            <h4>
              <T ns={NS}>Best summoner spells</T>
            </h4>
            {bestSpells ? (
              <>
                <Spells r={bestSpells} />
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
          {bestCore && (
            <div className="cp-best">
              <h4>
                <T ns={NS}>Best core build</T>
              </h4>
              <div className="cp-icons">
                {(bestCore.boots
                  ? [bestCore.boots, ...bestCore.items]
                  : bestCore.items
                ).map((id) => (
                  <ItemIcon key={id} id={id} info={info} />
                ))}
              </div>
              <div className="cp-mini">
                <RatedCells r={bestCore} />
              </div>
              {p.late.length > 0 && (
                <div className="cp-late-mini">
                  {p.late.map((s) => (
                    <div key={s.slot}>
                      <small>
                        <T ns={NS}>{SLOT_LABEL[s.slot]}</T>
                      </small>
                      <span className="cp-icons">
                        {s.options.slice(0, 2).map((r) => (
                          <ItemIcon
                            key={r.items[0]}
                            id={r.items[0]}
                            info={info}
                          />
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {bestSkill && (
            <div className="cp-best">
              <h4>
                <T ns={NS}>Best skill order</T>
              </h4>
              <Keys keys={bestSkill.max} />
              <div className="cp-mini">
                <RatedCells r={bestSkill} />
              </div>
            </div>
          )}
        </aside>

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
                  <T ns={NS}>
                    {
                      "Win rates are estimated. The boost below each is how much the augment adds to this champion's win rate."
                    }
                  </T>
                ) : undefined
              }
            >
              <AugmentTable rows={augRows} />
            </Panel>
          )}
          {est?.pairs.length ? (
            <Panel
              id="combos"
              title="Augment combinations"
              count={est.pairs.length}
              note={
                <T ns={NS}>
                  {
                    "Estimated: augments that pair well on this champion, with their win rate together."
                  }
                </T>
              }
            >
              <Head what="Augment pair" cols={["Est. win rate", "Pick rate"]} />
              <ShowMore total={est.pairs.length} limit={5}>
                {est.pairs.map((r, i) => (
                  <Row
                    key={r.ids.join("-")}
                    rank={i + 1}
                    cols={2}
                    cells={
                      <>
                        <Cell value={pct(r.winRate)} label="Est. win rate" />
                        <Cell value={pct(r.pickRate)} label="Pick rate" />
                      </>
                    }
                  >
                    <span className="cp-pair">
                      {r.ids.map((id) => (
                        <span key={id} className="cp-pair-one">
                          <img
                            className="cp-icon round"
                            src={`/icons/augments/${id}.webp`}
                            alt=""
                            width={32}
                            height={32}
                            loading="lazy"
                          />
                          <span className="cp-name">
                            <Name kind="augments" id={id}>
                              {AUG_NAMES[id] ?? ""}
                            </Name>
                          </span>
                        </span>
                      ))}
                    </span>
                  </Row>
                ))}
              </ShowMore>
            </Panel>
          ) : (
            <Panel id="combos" title="Augment combinations">
              <NotYet text="Augment pairs and their win rates appear here once enough games are in. Each pair needs a minimum number of games before it shows." />
            </Panel>
          )}

          <h2 className="cp-group" id="builds">
            <T ns={NS}>Builds</T>
          </h2>
          {p.core.length > 0 && (
            <Panel title="Core item builds" count={p.core.length}>
              <Head what="Core items" cols={SCORED_COLS} />
              <ShowMore total={p.core.length} limit={5}>
                {itemRows(p.core, true)}
              </ShowMore>
              {est && est.timing.length > 0 && (
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
          {p.late.length > 0 && (
            <Panel
              title="After the core"
              note={
                <T ns={NS}>
                  {
                    "Options for each item slot after the best core build, best DeepScore first. Each slot assumes you bought the top pick before it."
                  }
                </T>
              }
            >
              <div className="cp-late">
                {p.late.map((s) => (
                  <div key={s.slot}>
                    <h4>
                      <T ns={NS}>{SLOT_LABEL[s.slot]}</T>
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
                          <small className={tone(r.lift)}>
                            <T ns={NS} v={{ n: pct(r.winRate) }}>
                              {"{n} win rate"}
                            </T>
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
                <ShowMore total={p.starting.length} limit={null}>
                  {itemRows(p.starting)}
                </ShowMore>
              </Panel>
            )}
            {p.boots.length > 0 && (
              <Panel title="Boots" count={p.boots.length}>
                <Head what="Boots" cols={SCORED_COLS} />
                <ShowMore total={p.boots.length} limit={null}>
                  {singleRows(p.boots)}
                </ShowMore>
              </Panel>
            )}
          </div>
          {p.full.length > 0 && (
            <Panel title="Full builds" count={p.full.length} detailed>
              <Head what="Six items" cols={SCORED_COLS} />
              <ShowMore total={p.full.length} limit={5}>
                {itemRows(p.full)}
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
                            {r.deepScore !== undefined && (
                              <DeepScore
                                value={r.deepScore}
                                help={ITEM_DEEPSCORE_HELP}
                              />
                            )}
                            <Cell
                              value={pct(r.winRate)}
                              label="Win rate"
                              tone={tone(r.lift)}
                            />
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

          <h2 className="cp-group" id="playstyle">
            <T ns={NS}>Playstyle</T>
          </h2>
          <Panel
            title="Summoner spells"
            count={spells.length || undefined}
            note={spellsEstimated ? <T ns={NS}>Estimated</T> : undefined}
          >
            {spells.length ? (
              <>
                <Head
                  what="Spells"
                  cols={spellsEstimated ? ["Pick rate", "Games"] : undefined}
                />
                <ShowMore total={spells.length} limit={null}>
                  {spells.map((r, i) => (
                    <Row
                      key={i}
                      rank={i + 1}
                      cols={spellsEstimated ? 2 : 3}
                      cells={<SpellCells r={r} />}
                    >
                      <Spells r={r} />
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
                <T ns={NS}>
                  Max order, then the most common level-by-level order.
                </T>
              }
            >
              <Head what="Max order" />
              <ShowMore total={p.skills.length} limit={5}>
                {p.skills.map((s, i) => (
                  <Row key={i} rank={i + 1} cells={<RatedCells r={s} />}>
                    <Keys keys={s.max} />
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
                          value={signed(m.synergy)}
                          label="Win rate boost"
                          tone={tone(m.synergy)}
                        />
                        <Cell value={pct(m.pickRate)} label="Pick rate" />
                      </>
                    }
                  >
                    <Link className="cp-link" href={`/champions/${m.id}`}>
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
                    </Link>
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
                        <Cell value={pct(s.winRate)} label="Win rate" />
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
            name={c.name}
            changes={p.changes}
            modifiers={p.modifiers}
          />
          {p.stats && (
            <Fold section="details" titles={["Base stats"]}>
              <BaseStatsTable stats={p.stats} />
            </Fold>
          )}

          <h2 className="cp-group" id="performance">
            <T ns={NS}>Performance</T>
          </h2>
          {perf.length > 0 && (
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
                      <T
                        ns={NS}
                        v={{ n: vsAvg(a.key, est.vsAverage.get(a.key)!) }}
                      >
                        {"{n} vs average"}
                      </T>
                    </em>
                  )}
                </div>
              ))}
            </div>
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
              {est.curve && (
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
        </div>

        <SectionRail spots={SPOTS} />
      </div>
    </>
  );
}
