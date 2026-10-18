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
import { championTagData, championTags } from "@/lib/champion-tags";
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
import AugmentTable from "@/components/champion/AugmentTable";
import SectionRail from "@/components/champion/SectionRail";
import { BaseStatsTable, MayhemChanges } from "@/components/champion/Details";
import {
  fillEstimated,
  fillGames,
  fillSpells,
  type SpellRow,
} from "@/lib/fill";
import { ITEM_TIERS, type ItemTier } from "@/lib/items";
import { championEstimates } from "@/lib/estimates";
import championIds from "@/data/champion-ids.json";
import augmentNames from "@/data/augment-names.json";
import "../champion-page.css";

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
];
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
const SCORED_COLS = ["DeepScore", "Pick rate", "Win rate"];
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
      <Cell value={pct(r.pickRate)} label="Pick rate" />
      <Cell value={pct(r.winRate)} label="Win rate" tone={tone(r.lift)} />
    </>
  );
}

const TIER_LABEL: Record<ItemTier, string> = {
  legendary: "Legendary",
  boots: "Boots",
  epic: "Epic",
  basic: "Basic",
  starter: "Starter",
};

// One page per champion, so each can be found in search. Laid out like a stat site's champion page: a header
// with the headline numbers, then a summary card (best build, skill order), ranked tables in the middle and
// section links on the right. Every table runs on the live patch's numbers (lib/champion-page.ts).

export const dynamicParams = false;
export const generateStaticParams = () =>
  championAliases().map((alias) => ({ alias }));

const NS = "champions";
const pts = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)} pts`;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ alias: string }>;
}): Promise<Metadata> {
  const c = championSummary((await params).alias);
  if (!c) return {};
  const stats =
    c.winRate !== undefined
      ? ` ${c.tier} tier, ${pct(c.winRate)} win rate on patch ${c.patch}.`
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

/** Win rate, pick rate and lift, or just pick rate and games for estimated spells. */
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
        {r.items.map((id, j) => (
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
            <T ns={NS} v={{ v: c.patch ?? "" }}>
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
                <b className={tone(c.change)}>{pts(c.change)}</b>
                <small>
                  <T ns={NS} v={{ patch: c.prev ?? "" }}>
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
                  {"of {n}"}
                </T>
              </small>
            </div>
          </div>
        )}
      </section>

      <div className="cp">
        <aside className="cp-side" aria-label="Best picks">
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
                {bestCore.items.map((id) => (
                  <ItemIcon key={id} id={id} info={info} />
                ))}
              </div>
              <div className="cp-mini">
                <RatedCells r={bestCore} />
              </div>
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
                      "Win rates are estimated. Lift is how much each augment adds to this champion's win rate."
                    }
                  </T>
                ) : undefined
              }
            >
              <AugmentTable
                rows={p.augments
                  .map((a) => ({
                    ...a,
                    ...est?.augments.get(a.id),
                    deepScore: scores.get(a.id),
                    href: augmentHref(a.id) ?? undefined,
                  }))
                  .sort(
                    (x, y) =>
                      (y.deepScore ?? -1) - (x.deepScore ?? -1) ||
                      y.pickRate - x.pickRate,
                  )}
              />
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
            </Panel>
          )}
          <div className="cp-two">
            {p.starting.length > 0 && (
              <Panel title="Starter items" count={p.starting.length}>
                <Head what="Starter items" cols={SCORED_COLS} />
                <div className="cp-rows">{itemRows(p.starting)}</div>
              </Panel>
            )}
            {p.boots.length > 0 && (
              <Panel title="Boots" count={p.boots.length}>
                <Head what="Boots" cols={SCORED_COLS} />
                <div className="cp-rows">{singleRows(p.boots)}</div>
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
                          <Cell value={pct(r.pickRate)} label="Pick rate" />
                          <Cell
                            value={pct(r.winRate)}
                            label="Win rate"
                            tone={tone(r.lift)}
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
            </Panel>
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
              </>
            ) : (
              <NotYet text="Spell pairs with win rate, pick rate and win lift appear here once enough games are in." />
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
                    "How much more the pair wins than the two champions' own win rates predict, in percentage points. Above zero means they help each other."
                  }
                </T>
              }
            >
              <Head what="Teammate" cols={["Win rate delta", "Pick rate"]} />
              <ShowMore total={p.mates.length}>
                {p.mates.map((m, i) => (
                  <Row
                    key={m.id}
                    rank={i + 1}
                    cells={
                      <>
                        <Cell
                          value={signed(m.synergy)}
                          label="Win rate delta"
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

          <h2 className="cp-group" id="details">
            <T ns={NS}>More details</T>
          </h2>
          {p.styles.length > 0 && (
            <Panel title="Builds by style" count={p.styles.length} detailed>
              <Head
                what="Style"
                cols={["Win rate", "Build share", "Win lift"]}
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
                          label="Win lift"
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
          {p.stats && <BaseStatsTable stats={p.stats} />}

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
          {est && est.profile.length > 0 && (
            <Panel
              title="Typical game"
              note={<T ns={NS}>Estimated averages per game.</T>}
            >
              <div className="cp-profile">
                {PROFILE.map(([key, label, fmt]) => {
                  const s = est.profile.find((x) => x.key === key);
                  return s ? (
                    <div key={key} data-band={s.band}>
                      <small>
                        <T ns={NS}>{label}</T>
                      </small>
                      <b>{fmt(s.value)}</b>
                      <span>
                        <T ns={NS}>{BAND[s.band]}</T>
                      </span>
                    </div>
                  ) : null;
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
