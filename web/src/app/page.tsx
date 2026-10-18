import Link from "next/link";
import { text } from "@/lib/content";
import { chefsSpecial, statsDate, counts, kitchenBuilds, livePatch, liveTiers, topAugments, topDps } from "@/lib/highlights";
import { duoRows } from "@/lib/duos";
import { recap, recapPatches } from "@/lib/patches";
import { readRepoJson } from "@/lib/repo-data";
import type { PatchSchedule } from "@/lib/patch-schedule";
import PatchCountdown from "@/components/PatchCountdown";
import { championSplash } from "@/lib/champions";
import { KitchenPick, TierSnapshot } from "@/components/HomeWidgets";
import { augmentHref } from "@/lib/augments";
import { KITCHEN } from "@/lib/tabs";
import championNames from "@/data/champion-names.json";

const NAMES = championNames as Record<string, string>;
import RecentPlayed from "@/components/RecentPlayed";
import { LocalDate, ModeName, Name, T } from "@/components/I18n";

// eslint-disable-next-line @next/next/no-img-element
const Icon = ({ src }: { src: string }) => <img className="icon" src={src} alt="" width={24} height={24} loading="lazy" />;

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

// The pairs that help each other most on the live patch (synergy, the Duos tab's Win rate delta).
const topDuos = (n = 5) =>
  duoRows()
    .filter((d) => d.delta !== null)
    .sort((a, b) => b.delta! - a.delta!)
    .slice(0, n);
const pts = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)} pts`;

export default function Home() {
  const tiers = liveTiers();
  const augs = topAugments();
  const patch = livePatch();
  const special = chefsSpecial();
  const builds = special ? [] : kitchenBuilds();
  const n = counts();
  const date = statsDate();
  const duos = topDuos();
  const dps = topDps();
  const schedule = readRepoJson<PatchSchedule>("data/patch-schedule.json");
  const last = recapPatches()[0];
  const latest = last ? recap(last) : null;

  return (
    <>
      <section className="hero">
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
        </p>
        <h1>
          <T>{text("home.title", "Every Mayhem pick, measured.")}</T>
        </h1>
        <p className="lede">
          <T>{text("home.lede")}</T>
        </p>
      </section>

      <div className="bento">
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
            <TierSnapshot champs={tiers.map((c) => ({ ...c, splash: championSplash(c.id) }))} />
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
                <Link key={a.id} href={augmentHref(a.id) ?? `/tier-list?tab=augments&q=${encodeURIComponent(a.name)}`} data-tilt="soft" data-rarity={a.tier?.toLowerCase()}>
                  <span className="rank-i">{i + 1}</span>
                  <Icon src={`/icons/augments/${a.id}.webp`} />
                  <span className="rank-name">
                    <Name kind="augments" id={a.id}>
                      {a.name}
                    </Name>
                  </span>
                  <span className={`chip tier-${a.tier?.toLowerCase()}`}>{a.tier && <T>{a.tier}</T>}</span>
                  <span className="rank-v">{pct(a.winRate)}</span>
                </Link>
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
              <Link href="/tier-list?tab=duos">
                <T>All →</T>
              </Link>
            </div>
            <div className="rank home-duos">
              {duos.map((d) => (
                <Link key={d.pair} href={`/champions/${d.a}`}>
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
                  <span className="rank-v">{pts(d.delta!)}</span>
                </Link>
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
                <Link key={c.id} href={`/champions/${c.id}`}>
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
                </Link>
              ))}
            </div>
          </section>
        )}
        {special && (
          <section className="card span-4 feature chef-special" data-accent="lab">
            <div className="card-head">
              <h2>
                <T>Today&apos;s Chef Special</T>
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
                    <Link key={i.name} href={i.href} title={i.name}>
                      {i.icon ? <Icon src={i.icon} /> : i.name}
                    </Link>
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
            {special.winRate !== null && (
              <p className="table-note">
                <T v={{ wr: pct(special.winRate) }}>{"Won {wr} of games with this core."}</T>
              </p>
            )}
          </section>
        )}
        {schedule && (
          <section className="card span-all home-patch" data-accent="pbe">
            <PatchCountdown schedule={schedule} asOf={new Date().toISOString()} />
            {latest && (
              <Link className="home-recap" href={`/patches/${latest.patch}`}>
                <b>
                  <T v={{ patch: latest.patch }}>{"Patch {patch} recap"}</T>
                </b>
                <span>
                  {latest.hasAugmentHistory ? (
                    <T ns="patches" v={{ added: latest.added.length, removed: latest.removed.length, changed: latest.changed.length }}>
                      {"{added} added · {removed} removed · {changed} changed"}
                    </T>
                  ) : (
                    <T ns="patches">Win rates only</T>
                  )}
                </span>
                <span aria-hidden="true">→</span>
              </Link>
            )}
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
