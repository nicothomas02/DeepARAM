import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/JsonLd";
import Link from "next/link";
import { notFound } from "next/navigation";
import { livePatch } from "@/lib/highlights";
import { itemBySlug, itemPages } from "@/lib/item-pages";
import { itemSim } from "@/lib/item-sim";
import { itemEstimate } from "@/lib/estimates";
import { itemTag } from "@/lib/item-tags";
import { pageMeta } from "@/lib/meta";
import { Description, Name, T } from "@/components/I18n";
import descriptions from "@/data/descriptions.json";
import { patchName } from "@/lib/patch-name";
import { signedPts } from "@/components/champion/Ranked";

// One page per item Mayhem players build (lib/item-pages.ts).

export const dynamicParams = false;
export const generateStaticParams = () => itemPages().map((i) => ({ slug: i.slug }));

const DESC = descriptions as { augments: Record<string, string>; items: Record<string, string> };
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const signed = (v: number, unit = "") => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(unit ? 1 : 0)}${unit}`;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const i = itemBySlug((await params).slug);
  if (!i) return {};
  const who = i.builders.length
    ? ` Built most by ${i.builders
        .slice(0, 3)
        .map((b) => b.name)
        .join(", ")}.`
    : "";
  return pageMeta(`/items/${i.slug}`, `${i.name} in ARAM Mayhem`, `${i.name}: ${i.stats.join(", ") || "item"}${i.cost ? `, ${i.cost} gold` : ""}.${who}`);
}

export default async function ItemPage({ params }: { params: Promise<{ slug: string }> }) {
  const i = itemBySlug((await params).slug);
  if (!i) notFound();
  const sim = itemSim(i.id);
  const est = itemEstimate(i.id);
  return (
    <>
      <Breadcrumbs
        trail={[
          ["Items", "/tier-list?tab=items"],
          [i.name, `/items/${i.slug}`],
        ]}
      />
      <section className="champ-hero aug-hero">
        <p className="eyebrow">
          <Link href="/tier-list?tab=items">
            <T ns="items">Items</T>
          </Link>{" "}
          ·{" "}
          <T ns="items" v={{ patch: patchName(livePatch()) }}>
            {"Patch {patch}"}
          </T>
        </p>
        <div className="aug-hero-title">
          {i.icon && (
            <span className="tilt-icon" data-tilt data-rarity="gold">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="aug-hero-icon item-hero-icon" src={i.icon} alt="" width={72} height={72} />
            </span>
          )}
          <h1>
            <Name kind="items" id={i.id}>
              {i.name}
            </Name>{" "}
            <span className="champ-hero-sub">
              <T ns="items">in ARAM Mayhem</T>
            </span>
          </h1>
        </div>
        {DESC.items[String(i.id)] && (
          <Description kind="items" id={i.id}>
            {DESC.items[String(i.id)]}
          </Description>
        )}
        {i.tags.length > 0 && (
          <p className="item-tags-row">
            {i.tags.map((t) => (
              <Link key={t} href={`/tier-list?tab=items&itag=${t}`} className="item-tag" data-group={itemTag(t)?.group}>
                <T ns="items">{itemTag(t)?.label ?? t}</T>
              </Link>
            ))}
          </p>
        )}
        <div className="stat-row">
          {i.cost > 0 && (
            <div>
              <b>{i.cost.toLocaleString("en-US")}</b>
              <span>
                <T ns="items">gold</T>
              </span>
            </div>
          )}
          {i.stats.map((s) => {
            const [, value, label] = s.match(/^([\d.+%-]+)\s+(.+)$/) ?? [null, s, ""];
            return (
              <div key={s}>
                <b>{value}</b>
                <span>{label && <T ns="items">{label}</T>}</span>
              </div>
            );
          })}
        </div>
      </section>
      {est && (
        <section className="card" data-accent="gold">
          <div className="card-head">
            <h2>
              <T ns="items">How it does</T>
            </h2>
            <span className="card-note">
              <T ns="items">Estimated</T>
            </span>
          </div>
          <div className="stat-row">
            <div>
              <b className={est.winRate >= 0.52 ? "wr-high" : est.winRate <= 0.48 ? "wr-low" : ""}>{pct(est.winRate)}</b>
              <span>
                <T ns="items">win rate</T>
              </span>
            </div>
            <div>
              <b className={est.lift >= 0.005 ? "delta-up" : est.lift <= -0.005 ? "delta-down" : ""}><T ns="tables" v={{ n: signedPts(est.lift) }}>{"{n} pts"}</T></b>
              <span>
                <T ns="items">win rate boost</T>
              </span>
            </div>
            <div>
              <b>{pct(est.buildShare)}</b>
              <span>
                <T ns="items">of builds</T>
              </span>
            </div>
            {est.slots.some((s) => s > 0) && (
              <div>
                <b>{est.slots.map((s) => pct(s)).join(" · ")}</b>
                <span>
                  <T ns="items">bought 1st · 2nd · 3rd</T>
                </span>
              </div>
            )}
          </div>
          {est.granted && (
            <p className="table-note">
              <T ns="items">Some augments also grant this item.</T>
            </p>
          )}
        </section>
      )}
      {i.builders.length > 0 && (
        <section className="card" data-accent="tier">
          <div className="card-head">
            <h2>
              <T ns="items">Built most by</T>
            </h2>
          </div>
          <div className="rank builders">
            {i.builders.map((b) => (
              <Link key={b.id} href={`/champions/${b.id}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="icon" src={`/icons/champions/${b.id}.webp`} alt="" width={24} height={24} loading="lazy" />
                <span className="rank-name">
                  <Name kind="champions" id={b.id}>
                    {b.name}
                  </Name>
                </span>
                <span className="rank-v">
                  <T ns="items" v={{ pct: pct(b.pickRate) }}>
                    {"{pct} build"}
                  </T>
                </span>
                <span className={`rank-v ${b.winRate !== null && b.winRate >= 0.52 ? "wr-good" : ""}`}>
                  {b.winRate !== null ? (
                    <T ns="items" v={{ pct: pct(b.winRate) }}>
                      {"{pct} win"}
                    </T>
                  ) : (
                    ""
                  )}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {i.builders.length === 0 && i.tier !== "reward" && (
        <p className="table-note">
          <T ns="items">Rarely bought in ARAM Mayhem, so it has no win rate yet.</T>
        </p>
      )}
      {sim && (
        <section className="card item-sim" data-accent="sim">
          <div className="card-head">
            <h2>
              <T ns="items">Simulated damage</T>
            </h2>
            <Link href="/simulator">
              <T ns="items">Open the simulator →</T>
            </Link>
          </div>
          <div className="stat-row">
            <div>
              <b className={sim.gain >= 0.03 ? "wr-high" : sim.gain < 0 ? "wr-low" : ""}>{signed(sim.gain * 100, "%")}</b>
              <span>
                <T ns="items">damage</T>
              </span>
            </div>
            <div>
              <b>{signed(sim.alive, " s")}</b>
              <span>
                <T ns="items">time alive</T>
              </span>
            </div>
          </div>
          <div className="rank builders">
            {sim.champs.map((c) => (
              <Link key={c.id} href={`/champions/${c.id}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="icon" src={`/icons/champions/${c.id}.webp`} alt="" width={24} height={24} loading="lazy" />
                <span className="rank-name">
                  <Name kind="champions" id={c.id}>
                    {c.name}
                  </Name>
                </span>
                <span className={`rank-v ${c.gain >= 0.03 ? "wr-good" : ""}`}>
                  <T ns="items" v={{ v: signed(c.gain * 100, "%") }}>
                    {"{v} damage"}
                  </T>
                </span>
                <span className="rank-v">{c.dps.toLocaleString("en-US")} DPS</span>
              </Link>
            ))}
          </div>
          <p className="table-note">
            <T ns="items" v={{ patch: patchName(sim.patch) }}>
              {
                "Simulated on patch {patch}: each champion's best simulated build with and without this item, in the same fights. The top line is the middle result across these champions."
              }
            </T>
          </p>
        </section>
      )}
      <p className="patch-note">
        <T ns="items">{"Build rate is the share of that champion's games where they finished the item."}</T>
      </p>
    </>
  );
}
