import Link from "next/link";
import { SHOW_AUGMENT_WIN_RATES } from "@/lib/augment-policy";
import RowLink from "@/components/RowLink";
import { text } from "@/lib/content";
import { chefsSpecial, detailDate, statsDate, counts, kitchenBuilds, livePatch, liveTiers, topAugments, topDps, topItems } from "@/lib/highlights";
import { duoRows } from "@/lib/duos";
import { recap, recapPatches } from "@/lib/patches";
import { readRepoJson } from "@/lib/repo-data";
import type { PatchSchedule } from "@/lib/patch-schedule";
import PatchCountdown from "@/components/PatchCountdown";
import { championSplash, championTile } from "@/lib/champions";
import { FunLists, KitchenPick, TierSnapshot } from "@/components/HomeWidgets";
import { funLists, profileValue } from "@/lib/estimates";
import { liveWithChange } from "@/lib/champions";
import championIds from "@/data/champion-ids.json";
import { KITCHEN } from "@/lib/tabs";
import championNames from "@/data/champion-names.json";

const NAMES = championNames as Record<string, string>;
const ALIAS = Object.fromEntries(Object.entries(championIds as Record<string, number>).map(([alias, id]) => [id, alias]));
import RecentPlayed from "@/components/RecentPlayed";
import FreshChefSpecial from "@/components/FreshChefSpecial";
import { TourChip } from "@/components/FirstVisitTour";
import { LocalDate, ModeName, Name, T } from "@/components/I18n";
import { patchName } from "@/lib/patch-name";
import { signedPts } from "@/components/champion/Ranked";

// eslint-disable-next-line @next/next/no-img-element
const Icon = ({ src }: { src: string }) => <img className="icon" src={src} alt="" width={24} height={24} loading="lazy" />;

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

// The pairs that help each other most on the live patch: the Duos tab's order, by win rate boost (synergy
// adjusted for how often a pair is played, lib/duos.ts).
const topDuos = (n = 5) => [...duoRows()].sort((a, b) => b.delta - a.delta).slice(0, n);

// The number each "Top 10 at" list ranks on, written for its row (FunLists adds the unit): live-patch
// shares and estimated typical-game numbers.
function funValues(): Record<string, (id: number, alias: string) => string | null> {
  const live = new Map(liveWithChange().live.map((c) => [c.name, c]));
  const fmt = (v: number | null | undefined, f: (v: number) => string) => (typeof v === "number" ? f(v) : null);
  const int = (v: number) => Math.round(v).toLocaleString("en-US");
  const one = (v: number) => v.toFixed(1);
  return {
    damage: (_, a) => fmt(live.get(a)?.damage, pct),
    tank: (_, a) => fmt(live.get(a)?.tank, pct),
    teamplay: (_, a) => fmt(live.get(a)?.kp, pct),
    healing: (id) => fmt(profileValue(id, "heal_per_min"), int),
    crowd_control: (id) => fmt(profileValue(id, "cc_seconds"), one),
    dead: (_, a) => fmt(live.get(a)?.dead, (v) => `${Math.floor(v / 60)}m ${String(Math.round(v % 60)).padStart(2, "0")}s`),
  };
}

const PILLARS: [string, string][] = [
  [
    "Every augment, ranked for you",
    "All the augments, quests and Mayhem-only items, scored for each champion. Mark what you took and the rest re-rank around it.",
  ],
  [
    "Data science, not raw counts",
    "DeepScore weighs sample size, shows how sure it is, and estimates what each augment adds to your champion. It even forecasts patches before they land.",
  ],
  [
    "A fight simulator to play with",
    "Pit any build against real kits in a 3D replay. It's a sandbox for fun, so no ranking on the site leans on it.",
  ],
];

export default function Home() {
  const tiers = liveTiers();
  const augs = topAugments();
  const gear = topItems();
  const patch = livePatch() && patchName(livePatch());
  const special = chefsSpecial();
  const builds = special ? [] : kitchenBuilds();
  const n = counts();
  const date = statsDate();
  const detail = detailDate();
  const duos = topDuos();
  const dps = topDps();
  const schedule = readRepoJson<PatchSchedule>("data/patch-schedule.json");
  const last = recapPatches()[0];
  const latest = last ? recap(last) : null;
  const value = funValues();
  // Lists the daily estimates don't carry are ranked here, from the same numbers (most time dead first).
  const live = new Map(liveWithChange().live.map((c) => [c.name, c]));
  const topBy = (key: (id: number) => number | null | undefined, low = false) =>
    Object.values(championIds as Record<string, number>)
      .flatMap((id) => {
        const v = key(id);
        return typeof v === "number" ? [{ id, v }] : [];
      })
      .sort((a, b) => (low ? a.v - b.v : b.v - a.v))
      .slice(0, 10)
      .map((x) => x.id);
  const extra = {
    dead: topBy((id) => live.get(ALIAS[id])?.dead),
  };
  // Six lists, the ones a player reads a champion by (Nico, 2026-11-24: trimmed from 12 to cut bloat).
  const KEEP = new Set(["damage", "tank", "healing", "crowd_control", "teamplay", "dead"]);
  const fun = Object.fromEntries(
    Object.entries({ ...funLists(), ...extra }).filter(([k]) => KEEP.has(k)).map(([k, ids]) => [
      k,
      ids.flatMap((id) => (ALIAS[id] ? [{ id: ALIAS[id], name: NAMES[ALIAS[id]] ?? ALIAS[id], value: value[k]?.(id, ALIAS[id]) ?? null }] : [])),
    ]),
  );

  return (
    <>
      <section className="hero has-art" style={{ "--art": "url(/assets/art/arambloom.webp)" } as React.CSSProperties}>
        <p className="eyebrow">
          <ModeName />
          {patch && (
            <>
              {" · "}
              <T v={{ patch }}>{"Patch {patch}"}</T>
            </>
          )}
          {date && (
            <>
              {" · "}
              <T>Last updated</T> <LocalDate iso={date.toISOString()} />
            </>
          )}
          {detail && (
            <>
              {" · "}
              <T>Builds and augments from games up to</T> <LocalDate iso={detail.toISOString()} />
            </>
          )}
        </p>
        <h1>
          <T>{text("home.title", "Every Mayhem pick, measured.")}</T>
        </h1>
        {/* Not .lede: Simple view hides those, and this line says what the site is. */}
        <p className="hero-tagline">
          <T>{text("home.lede")}</T>
        </p>
        <div className="hero-actions">
          <Link className="btn" href="/tier-list">
            <T>Tier List</T>
          </Link>
          <Link className="btn ghost" href="/simulator">
            <T>Simulator</T>
          </Link>
          <TourChip />
        </div>
      </section>

      {/* What sets the site apart (Nico, 2026-11-20). */}
      <section className="home-pillars" aria-label="Why DeepARAM">
        {PILLARS.map(([title, body]) => (
          <div key={title} className="home-pillar">
            <h2>
              <T>{title}</T>
            </h2>
            <p>
              <T>{body}</T>
            </p>
          </div>
        ))}
      </section>

      <div className="bento">
        {schedule && (
          <section className="card span-all home-patch" data-accent="pbe">
            <PatchCountdown schedule={schedule} asOf={new Date().toISOString()} dataPatch={livePatch()} />
            {latest && (
              <Link className="home-recap" href={`/patches/${patchName(latest.patch)}`}>
                <b>
                  <T v={{ patch: patchName(latest.patch) }}>{"Patch {patch} recap"}</T>
                </b>
                <span>
                  {latest.hasAugmentHistory ? (
                    <>
                      {/* Same summary as the Patches page: added and removed first, so a patch that only adds
                          augments doesn't read as "2 augments changed". */}
                      {latest.added.length > 0 && (
                        <>
                          <T ns="patches" v={{ n: latest.added.length }}>
                            {"{n} added"}
                          </T>
                          {" · "}
                        </>
                      )}
                      {latest.removed.length > 0 && (
                        <>
                          <T ns="patches" v={{ n: latest.removed.length }}>
                            {"{n} removed"}
                          </T>
                          {" · "}
                        </>
                      )}
                      <T ns="patches" v={{ n: latest.changed.length }}>
                        {"{n} augments changed"}
                      </T>
                    </>
                  ) : (
                    <T ns="patches">Win rates only</T>
                  )}
                </span>
                <span aria-hidden="true">→</span>
              </Link>
            )}
          </section>
        )}
        <RecentPlayed />
        {tiers.length > 0 && (
          <section className="card span-7" data-accent="tier">
            <div className="card-head">
              <h2>
                <T>Tier List</T>
                {patch && (
                  <>
                    {" · "}
                    <T v={{ patch }}>{"Patch {patch}"}</T>
                  </>
                )}
              </h2>
              <Link href="/tier-list">
                <T v={{ n: n.champions }}>{"All {n} →"}</T>
              </Link>
            </div>
            <TierSnapshot champs={tiers.map((c) => ({ ...c, splash: championSplash(c.id), splashSmall: championTile(c.id) }))} />
          </section>
        )}
        {augs.length > 0 && (
          <section className="card span-5" data-accent="gold">
            <div className="card-head">
              <h2>
                <T>Best augments</T>
              </h2>
              <Link href="/tier-list?tab=augments">
                <T>All →</T>
              </Link>
            </div>
            <div className="rank">
              {augs.map((a, i) => (
                <RowLink key={a.id} href={a.href} data-tilt="soft" data-rarity={a.rarity}>
                  <span className="rank-i">{i + 1}</span>
                  <Icon src={`/icons/augments/${a.id}.webp`} />
                  <span className="rank-name">
                    <Name kind="augments" id={a.id}>
                      {a.name}
                    </Name>
                  </span>
                  <span className={`chip tier-${a.tier?.toLowerCase()}`}>{a.tier && <T>{a.tier}</T>}</span>
                  <span className="rank-v">{Math.round(a.deepScore)}</span>
                </RowLink>
              ))}
            </div>
          </section>
        )}
        {gear.length > 0 && (
          <section className="card span-all" data-accent="gold">
            <div className="card-head">
              <h2>
                <T>Best items</T>
              </h2>
              <Link href="/tier-list?tab=items">
                <T>All →</T>
              </Link>
            </div>
            <div className="rank">
              {gear.map((i, n) => (
                <RowLink key={i.id} href={`/items/${i.slug}`} data-tilt="soft">
                  <span className="rank-i">{n + 1}</span>
                  {i.icon ? <Icon src={i.icon} /> : null}
                  <span className="rank-name">
                    <Name kind="items" id={String(i.id)}>
                      {i.name}
                    </Name>
                  </span>
                  <span className="rank-v">{Math.round(i.deepScore ?? 0)}</span>
                </RowLink>
              ))}
            </div>
          </section>
        )}
        {duos.length > 0 && (
          <section className="card span-4" data-accent="tier">
            <div className="card-head">
              <h2>
                <T>Best duos</T>
              </h2>
              <Link href="/tier-list?cview=duos">
                <T>All →</T>
              </Link>
            </div>
            <div className="rank home-duos">
              {duos.map((d) => (
                <RowLink key={d.pair} href={`/champions/${d.a}`}>
                  <span className="home-duo-icons">
                    <Icon src={`/icons/champions/${d.a}.webp`} />
                    <Icon src={`/icons/champions/${d.b}.webp`} />
                  </span>
                  <span className="rank-name">
                    <Name kind="champions" id={d.a}>
                      {NAMES[d.a] ?? d.a}
                    </Name>
                    {" + "}
                    <Name kind="champions" id={d.b}>
                      {NAMES[d.b] ?? d.b}
                    </Name>
                  </span>
                  <span className="rank-v">
                    <T ns="tables" v={{ n: signedPts(d.delta) }}>
                      {"{n} pts"}
                    </T>
                  </span>
                </RowLink>
              ))}
            </div>
          </section>
        )}
        {dps.length > 0 && (
          <section className="card span-4" data-accent="sim">
            <div className="card-head">
              <h2>
                <T>Most simulated damage</T>
              </h2>
              <Link href="/simulator">
                <T>Simulator →</T>
              </Link>
            </div>
            <div className="rank home-dps">
              {dps.map((c, i) => (
                <RowLink key={c.id} href={`/champions/${c.id}`}>
                  <span className="rank-i">{i + 1}</span>
                  <Icon src={`/icons/champions/${c.id}.webp`} />
                  <span className="rank-name">
                    <Name kind="champions" id={c.id}>
                      {c.name}
                    </Name>
                  </span>
                  <span className="rank-v">
                    <T v={{ n: Math.round(c.dps).toLocaleString("en-US") }}>{"{n} DPS"}</T>
                  </span>
                </RowLink>
              ))}
            </div>
            <p className="card-note home-dps-note">
              <T>Training dummy at 50% Health</T>
            </p>
          </section>
        )}
        {special && (
          <section className="card span-4 feature chef-special" data-accent="lab" data-special={special.id}>
            <FreshChefSpecial id={special.id} />
            <div className="card-head">
              <h2>
                <T>This week&apos;s Chef Special</T>
              </h2>
              <Link href={special.href}>
                <T>The Kitchen →</T>
              </Link>
            </div>
            <Link className="kitchen-head" href={special.href}>
              <Icon src={`/icons/champions/${special.champion}.webp`} />
              <div>
                <p className="eyebrow">
                  <Name kind="champions" id={special.champion}>
                    {special.name}
                  </Name>
                  {special.tier && ` · ${special.tier}`}
                </p>
                <h3>{special.title}</h3>
              </div>
            </Link>
            {special.items.length > 0 && (
              <div className="chef-items">
                {special.items.map((i) =>
                  i.href ? (
                    <RowLink key={i.name} href={i.href} title={i.name}>
                      {i.icon ? <Icon src={i.icon} /> : i.name}
                    </RowLink>
                  ) : (
                    <span key={i.name} className="chip">
                      {i.name}
                    </span>
                  ),
                )}
              </div>
            )}
            {special.augments.some((a) => a.core) && (
              <div className="chips">
                {special.augments
                  .filter((a) => a.core)
                  .map((a) => (
                    <span key={a.name} className={`chip tier-${a.rarity}`}>
                      {a.name}
                    </span>
                  ))}
              </div>
            )}
            {SHOW_AUGMENT_WIN_RATES && special.winRate !== null && (
              <p className="table-note">
                <T v={{ wr: pct(special.winRate) }}>{"Won {wr} of games with this core."}</T>
              </p>
            )}
          </section>
        )}
        {Object.values(fun).some((l) => l.length) && (
          <section className="card span-all" data-accent="tier">
            <div className="card-head">
              <h2>
                <T>Top 10 at</T>
              </h2>
              <span className="card-note">
                <T>Estimated</T>
              </span>
            </div>
            <FunLists lists={fun} />
          </section>
        )}
        {builds.length > 0 && (
          <section className="card span-all feature" data-accent="lab">
            <div className="card-head">
              <h2>
                <T>Cook builds from The Kitchen</T>
              </h2>
              <Link href={KITCHEN}>
                <T>More →</T>
              </Link>
            </div>
            <KitchenPick builds={builds} />
          </section>
        )}
      </div>
    </>
  );
}
