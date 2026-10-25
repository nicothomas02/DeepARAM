import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/JsonLd";
import Link from "next/link";
import RowLink from "@/components/RowLink";
import { notFound } from "next/navigation";
import { augmentBySlug, augmentPages } from "@/lib/augments";
import { livePatch } from "@/lib/highlights";
import { pageMeta } from "@/lib/meta";
import { readRepoJson } from "@/lib/repo-data";
import { augmentItems, augmentStages, rarityOdds } from "@/lib/estimates";
import { item } from "@/lib/items";
import { itemPages } from "@/lib/item-pages";
import ShareButton from "@/components/ShareButton";
import ShareCard from "@/components/ShareCard";
import { Description, Name, T } from "@/components/I18n";
import descriptions from "@/data/descriptions.json";
import { patchName } from "@/lib/patch-name";

// One page per augment, so each can be found in search (lib/augments.ts).

export const dynamicParams = false;
export const generateStaticParams = () => augmentPages().map((a) => ({ slug: a.slug }));

const DESC = descriptions as { augments: Record<string, string>; items: Record<string, string> };
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const RARITY: Record<string, string> = {
  silver: "Silver",
  gold: "Gold",
  prismatic: "Prismatic",
};
type Odds = Record<string, { pool: number; offer: number; withRerolls: number }>;
const odds = (tier: string) => readRepoJson<{ odds?: Odds }>("guide/augment_rules.json")?.odds?.[RARITY[tier] ?? tier];

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const a = augmentBySlug((await params).slug);
  if (!a) return {};
  const best = a.best.length
    ? ` Best on ${a.best
        .slice(0, 3)
        .map((c) => c.name)
        .join(", ")}.`
    : "";
  return pageMeta(
    `/augments/${a.slug}`,
    `${a.name} ARAM Mayhem Augment`,
    `${a.name} is a ${RARITY[a.tier] ?? a.tier} ARAM Mayhem augment with a ${pct(a.winRate)} win rate on patch ${patchName(livePatch())}.${best}`,
  );
}

export default async function AugmentPage({ params }: { params: Promise<{ slug: string }> }) {
  const a = augmentBySlug((await params).slug);
  if (!a) notFound();
  const patch = livePatch() && patchName(livePatch());
  const offer = odds(a.tier);
  const stages = augmentStages(a.id);
  const rarity = rarityOdds(a.tier);
  const pages = new Map(itemPages().map((i) => [i.id, i.slug]));
  const fits = augmentItems(a.id).flatMap((f) => {
    const it = item(f.id);
    return it ? [{ id: f.id, name: it.name, icon: it.icon, slug: pages.get(f.id), share: f.share }] : [];
  });
  return (
    <>
      <Breadcrumbs
        trail={[
          ["Augments", "/tier-list?tab=augments"],
          [a.name, `/augments/${a.slug}`],
        ]}
      />
      <section className="champ-hero aug-hero">
        <p className="eyebrow">
          <Link href="/tier-list?tab=augments">
            <T ns="augments">Augments</T>
          </Link>{" "}
          ·{" "}
          <T ns="augments" v={{ patch: patch ?? "" }}>
            {"Patch {patch}"}
          </T>
        </p>
        <div className="aug-hero-title">
          <span className="tilt-icon" data-tilt data-rarity={a.tier}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="aug-hero-icon" data-tier={a.tier} src={`/icons/augments/${a.id}.webp`} alt="" width={72} height={72} />
          </span>
          <h1>
            <Name kind="augments" id={a.id}>
              {a.name}
            </Name>{" "}
            <span className="champ-hero-sub">
              <T ns="augments">ARAM Mayhem augment</T>
            </span>
          </h1>
        </div>
        {DESC.augments[String(a.id)] && (
          <Description kind="augments" id={a.id}>
            {DESC.augments[String(a.id)]}
          </Description>
        )}
        <div className="stat-row">
          <div>
            <b className="has-chip">
              <span className={`chip tier-${a.tier}`}>
                <T ns="augments">{RARITY[a.tier] ?? a.tier}</T>
              </span>
            </b>
            <span>
              <T ns="augments">rarity</T>
            </span>
          </div>
          <div>
            <b className={a.winRate >= 0.52 ? "wr-high" : a.winRate <= 0.48 ? "wr-low" : ""}>{pct(a.winRate)}</b>
            <span>
              {a.winRank ? (
                <T ns="augments" v={{ rank: a.winRank, of: a.of }}>
                  {"win rate, #{rank} of {of}"}
                </T>
              ) : (
                <T ns="augments">win rate</T>
              )}
            </span>
          </div>
          <div>
            <b>{pct(a.pickRate)}</b>
            <span>
              {a.pickRank ? (
                <T ns="augments" v={{ rank: a.pickRank, of: a.of }}>
                  {"pick rate, #{rank} of {of}"}
                </T>
              ) : (
                <T ns="augments">pick rate</T>
              )}
            </span>
          </div>
        </div>
        {offer && (
          <p className="aug-odds">
            <T
              ns="augments"
              v={{
                offer: pct(offer.offer),
                rerolls: pct(offer.withRerolls),
                pool: offer.pool,
              }}
            >
              {`Offered in {offer} of ${RARITY[a.tier]} selections ({rerolls} using every reroll), one of {pool} ${RARITY[a.tier]} augments.`}
            </T>{" "}
            <Link className="inline-link" href="/info#stages">
              <T ns="augments">How augment picks work</T>
            </Link>
          </p>
        )}
        <p className="champ-hero-links">
          <ShareButton title={a.name} />
          <ShareCard
            spec={{
              title: a.name,
              subtitle: `${RARITY[a.tier] ?? a.tier} augment · Patch ${patch ?? ""}`,
              icon: `/icons/augments/${a.id}.webp`,
              stats: [
                {
                  label: "Win rate",
                  value: pct(a.winRate),
                  tone: a.winRate >= 0.52 ? "good" : a.winRate <= 0.48 ? "bad" : undefined,
                },
                { label: "Pick rate", value: pct(a.pickRate) },
                ...(a.winRank ? [{ label: "Win rank", value: `#${a.winRank} of ${a.of}` }] : []),
              ],
              row: a.best.length
                ? {
                    label: "Best on",
                    icons: a.best.slice(0, 6).map((b) => `/icons/champions/${b.id}.webp`),
                  }
                : undefined,
              url: `https://deeparam.com/augments/${a.slug}`,
            }}
          />
        </p>
      </section>
      <div className="bento">
        {a.best.length > 0 && (
          <section className="card span-6" data-accent="tier">
            <div className="card-head">
              <h2>
                <T ns="augments">Best champions for it</T>
              </h2>
              <span className="card-note">
                <T ns="tables">Win rate boost</T> · <T ns="augments">Estimated</T>
              </span>
            </div>
            <div className="rank plain">
              {a.best.map((c) => (
                <RowLink key={c.id} href={`/champions/${c.id}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="icon" src={`/icons/champions/${c.id}.webp`} alt="" width={24} height={24} loading="lazy" />
                  <span className="rank-name">
                    <Name kind="champions" id={c.id}>
                      {c.name}
                    </Name>
                  </span>
                  {c.boost !== null && (
                    <span className={`rank-v ${c.boost >= 0 ? "delta-up" : "delta-down"}`}>
                      <T ns="tables" v={{ n: `${c.boost >= 0 ? "+" : "−"}${Math.abs(c.boost * 100).toFixed(1)}` }}>
                        {"{n} pts"}
                      </T>
                    </span>
                  )}
                </RowLink>
              ))}
            </div>
          </section>
        )}
        {a.pickers.length > 0 && (
          <section className="card span-6" data-accent="gold">
            <div className="card-head">
              <h2>
                <T ns="augments">Picked most by</T>
              </h2>
            </div>
            <div className="rank plain">
              {a.pickers.map((c) => (
                <RowLink key={c.id} href={`/champions/${c.id}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="icon" src={`/icons/champions/${c.id}.webp`} alt="" width={24} height={24} loading="lazy" />
                  <span className="rank-name">
                    <Name kind="champions" id={c.id}>
                      {c.name}
                    </Name>
                  </span>
                  <span className="rank-v">{pct(c.pickRate)}</span>
                </RowLink>
              ))}
            </div>
          </section>
        )}
        {stages && (
          <section className="card span-6" data-accent="sim">
            <div className="card-head">
              <h2>
                <T ns="augments">When it&apos;s picked</T>
              </h2>
              <span className="card-note">
                <T ns="augments">Estimated</T>
              </span>
            </div>
            <div className="rank plain aug-stages">
              {stages.stages.map((share, k) => (
                <div key={k} className={k + 1 === stages.usual ? "is-top" : undefined}>
                  <span className="rank-name">
                    <T ns="augments" v={{ n: k + 1 }}>
                      {"Augment {n}"}
                    </T>
                  </span>
                  <span className="rank-v">{pct(share)}</span>
                  {rarity && (
                    <span className="rank-v">
                      <T ns="augments" v={{ pct: pct(rarity.byStage[k]) }}>
                        {"{pct} of picks here are this rarity"}
                      </T>
                    </span>
                  )}
                </div>
              ))}
            </div>
            <p className="table-note">
              <T ns="augments">Share of this augment&apos;s picks at each augment selection, and how often a pick there is of its rarity.</T>
            </p>
          </section>
        )}
        {fits.length > 0 && (
          <section className="card span-6" data-accent="lab">
            <div className="card-head">
              <h2>
                <T ns="augments">Items that go with it</T>
              </h2>
              <span className="card-note">
                <T ns="augments">Estimated</T>
              </span>
            </div>
            <div className="rank plain aug-fits">
              {fits.map((f) => {
                const body = (
                  <>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {f.icon && <img className="icon" src={f.icon} alt="" width={24} height={24} loading="lazy" />}
                    <span className="rank-name">
                      <Name kind="items" id={f.id}>
                        {f.name}
                      </Name>
                    </span>
                    <span className="rank-v">{pct(f.share)}</span>
                  </>
                );
                return f.slug ? (
                  <RowLink key={f.id} href={`/items/${f.slug}`}>
                    {body}
                  </RowLink>
                ) : (
                  <div key={f.id}>{body}</div>
                );
              })}
            </div>
            <p className="table-note">
              <T ns="augments">Share of the champions who take this augment that build each item.</T>
            </p>
          </section>
        )}
      </div>
      <p className="patch-note">
        <T ns="augments">{"\u201cPicked most by\u201d shows the share of each champion's games where they took this augment."}</T>{" "}
        <Link className="inline-link" href="/tier-list?tab=augments">
          <T ns="augments">Every augment ranked S to D is on the Tier List →</T>
        </Link>
      </p>
    </>
  );
}
