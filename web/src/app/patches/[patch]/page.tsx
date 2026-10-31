import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/JsonLd";
import Link from "next/link";
import RowLink from "@/components/RowLink";
import { notFound } from "next/navigation";
import { pageMeta } from "@/lib/meta";
import { recap, recapPatches, type AugRef } from "@/lib/patches";
import { Description, LocalDate, Name, T } from "@/components/I18n";
import { augmentPages } from "@/lib/augments";
import descriptions from "@/data/descriptions.json";
import { patchName, patchVersion } from "@/lib/patch-name";
import { setOf } from "@/lib/sets";

// One recap per patch: augment changes and the champions that rose and fell most (lib/patches.ts).

export const dynamicParams = false;
export const generateStaticParams = () => recapPatches().map((patch) => ({ patch: patchName(patch) }));

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const pts = (v: number) => (Math.abs(v) * 100).toFixed(1);

export async function generateMetadata({ params }: { params: Promise<{ patch: string }> }): Promise<Metadata> {
  const r = recap(patchVersion((await params).patch));
  if (!r) return {};
  const top = r.up[0] ? ` ${r.up[0].name} rose the most.` : "";
  return pageMeta(
    `/patches/${patchName(r.patch)}`,
    `ARAM Mayhem Patch ${patchName(r.patch)} Recap`,
    `What changed in ARAM Mayhem on patch ${patchName(r.patch)}: ${[r.added.length && `${r.added.length} augments added`, r.removed.length && `${r.removed.length} removed`, `${r.changed.length} augments changed`].filter(Boolean).join(", ")}.${top}`,
  );
}

const EFFECT = (descriptions as { augments: Record<string, string> }).augments;
// Today's rarity and win rate for augments still in the pool (new ones keep no rarity in the patch history).
const live = () => new Map(augmentPages().map((p) => [String(p.id), p]));

function Aug({ a, info }: { a: AugRef; info?: { tier: string; winRate: number } }) {
  const tier = a.tier || info?.tier;
  const effect = info ? (EFFECT[a.id] ?? "") : undefined;
  const body = (
    <>
      {a.icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="icon" src={`/icons/augments/${a.id}.webp`} alt="" width={24} height={24} loading="lazy" />
      ) : (
        <span className="icon" aria-hidden="true" />
      )}
      {effect !== undefined ? (
        <span className="recap-what">
          <span className="recap-title">
            <span className="rank-name">
              <Name kind="augments" id={a.id}>
                {a.name}
              </Name>
            </span>
            {tier && (
              <span className={`recap-rarity ${tier.toLowerCase()}`}>
                <T ns="patches">{tier[0].toUpperCase() + tier.slice(1).toLowerCase()}</T>
              </span>
            )}
          </span>
          {effect && (
            <Description kind="augments" id={a.id}>
              {effect}
            </Description>
          )}
        </span>
      ) : (
        <span className="rank-name">
          <Name kind="augments" id={a.id}>
            {a.name}
          </Name>
        </span>
      )}
      {tier && effect === undefined && (
        <span className={`chip tier-${tier}`}>
          <T ns="patches">{tier[0].toUpperCase() + tier.slice(1)}</T>
        </span>
      )}
      {info && (
        <span className={`rank-v ${info.winRate >= 0.52 ? "wr-good" : ""}`}>
          {pct(info.winRate)}
        </span>
      )}
    </>
  );
  return a.href ? (
    <RowLink href={a.href} data-tilt="soft" data-rarity={a.tier}>
      {body}
    </RowLink>
  ) : (
    <div>{body}</div>
  );
}

export default async function PatchPage({ params }: { params: Promise<{ patch: string }> }) {
  const r = recap(patchVersion((await params).patch));
  if (!r) notFound();
  const pages = live();
  const all = recapPatches();
  const i = all.indexOf(r.patch);
  const newer = i > 0 ? all[i - 1] : null;
  const older = all[i + 1] ?? null;
  const quiet = r.hasAugmentHistory && !r.added.length && !r.removed.length && !r.changed.length;
  return (
    <>
      <Breadcrumbs
        trail={[
          ["Patches", "/patches"],
          [`Patch ${patchName(r.patch)}`, `/patches/${patchName(r.patch)}`],
        ]}
      />
      <section className="champ-hero">
        <p className="eyebrow">
          <Link href="/patches">
            <T ns="patches">Patches</T>
          </Link>
          {" · "}
          <T ns="patches">{setOf(r.patch).name}</T>
          {setOf(r.patch).first === r.patch && (
            <>
              {" · "}
              <T ns="patches">New set</T>
            </>
          )}
          {r.released && (
            <>
              {" · "}
              <LocalDate
                iso={`${r.released}T12:00:00Z`}
                options={{
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "UTC",
                }}
              />
            </>
          )}
        </p>
        <h1>
          <T ns="patches" v={{ patch: patchName(r.patch) }}>
            {"Patch {patch}"}
          </T>{" "}
          <span className="champ-hero-sub">
            <T ns="patches">ARAM Mayhem recap</T>
          </span>
        </h1>
        <div className="stat-row">
          {r.added.length > 0 && (
            <div>
              <b>{r.added.length}</b>
              <span>
                <T ns="patches">augments added</T>
              </span>
            </div>
          )}
          {r.removed.length > 0 && (
            <div>
              <b>{r.removed.length}</b>
              <span>
                <T ns="patches">removed</T>
              </span>
            </div>
          )}
          <div>
            <b>{r.changed.length}</b>
            <span>
              <T ns="patches">augments changed</T>
            </span>
          </div>
          <div>
            <b>{r.days}</b>
            <span>
              <T ns="patches">days of games</T>
            </span>
          </div>
        </div>
      </section>
      <div className="bento">
        {r.up.length > 0 && (
          <section className="card span-6" data-accent="tier">
            <div className="card-head">
              <h2>
                <T ns="patches">Rose the most</T>
              </h2>
              <span className="card-note">
                <T ns="patches" v={{ patch: patchName(r.prev) }}>
                  {"win rate vs {patch}"}
                </T>
              </span>
            </div>
            <div className="rank plain recap-movers">
              {r.up.map((c) => (
                <RowLink key={c.id} href={`/champions/${c.id}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="icon" src={`/icons/champions/${c.id}.webp`} alt="" width={24} height={24} loading="lazy" />
                  <span className="rank-name">
                    <Name kind="champions" id={c.id}>
                      {c.name}
                    </Name>
                  </span>
                  <span className="rank-v">{pct(c.winRate)}</span>
                  <span className="rank-v delta-up">{pts(c.change)}</span>
                </RowLink>
              ))}
            </div>
          </section>
        )}
        {r.down.length > 0 && (
          <section className="card span-6" data-accent="pbe">
            <div className="card-head">
              <h2>
                <T ns="patches">Fell the most</T>
              </h2>
              <span className="card-note">
                <T ns="patches" v={{ patch: patchName(r.prev) }}>
                  {"win rate vs {patch}"}
                </T>
              </span>
            </div>
            <div className="rank plain recap-movers">
              {r.down.map((c) => (
                <RowLink key={c.id} href={`/champions/${c.id}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="icon" src={`/icons/champions/${c.id}.webp`} alt="" width={24} height={24} loading="lazy" />
                  <span className="rank-name">
                    <Name kind="champions" id={c.id}>
                      {c.name}
                    </Name>
                  </span>
                  <span className="rank-v">{pct(c.winRate)}</span>
                  <span className="rank-v delta-down">{pts(c.change)}</span>
                </RowLink>
              ))}
            </div>
          </section>
        )}
        {r.changed.length > 0 && (
          <section className="card span-all" data-accent="sim">
            <div className="card-head">
              <h2>
                <T ns="patches">Augments changed</T>
              </h2>
            </div>
            <ul className="recap-changes">
              {r.changed.map((a) => (
                <li key={a.id}>
                  <div className="rank plain recap-list">
                    <Aug a={a} />
                  </div>
                  <ul>
                    {a.changes.map((x) => (
                      <li key={x.name}>
                        {x.old === "none" ? (
                          <>
                            {x.name}: <T ns="patches">now</T> <b>{x.new}</b>
                          </>
                        ) : x.new === "none" ? (
                          <>
                            {x.name}: <T ns="patches">removed</T>
                          </>
                        ) : (
                          <>
                            {x.name}: <s>{x.old}</s> → <b>{x.new}</b>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        )}
        {r.added.length > 0 && (
          <section className="card span-6" data-accent="gold">
            <div className="card-head">
              <h2>
                <T ns="patches">Augments added</T>
              </h2>
              <span className="card-note">
                <T ns="patches">win rate so far</T>
              </span>
            </div>
            <div className="rank plain recap-list recap-added">
              {r.added.map((a) => (
                <Aug key={a.id} a={a} info={pages.get(a.id)} />
              ))}
            </div>
          </section>
        )}
        {r.removed.length > 0 && (
          <section className="card span-6" data-accent="lab">
            <div className="card-head">
              <h2>
                <T ns="patches">Augments removed</T>
              </h2>
            </div>
            <div className="rank plain recap-list">
              {r.removed.map((a) => (
                <Aug key={a.id} a={a} />
              ))}
            </div>
          </section>
        )}
      </div>
      <p className="patch-note">
        {quiet ? (
          <>{<T ns="patches">No augment changes this patch.</T>} </>
        ) : !r.hasAugmentHistory ? (
          <>{<T ns="patches">{"Augment changes aren't tracked for this patch, only win rates."}</T>} </>
        ) : (
          ""
        )}
        {r.prev ? (
          <T ns="patches" v={{ patch: patchName(r.prev) }}>
            {"Win-rate changes compare each champion with patch {patch}."}
          </T>
        ) : (
          <T ns="patches">Win-rate changes compare each champion with the patch before.</T>
        )}{" "}
        {older && (
          <Link className="inline-link" href={`/patches/${patchName(older)}`}>
            ←{" "}
            <T ns="patches" v={{ patch: patchName(older) }}>
              {"Patch {patch}"}
            </T>
          </Link>
        )}
        {older && newer && " · "}
        {newer && (
          <Link className="inline-link" href={`/patches/${patchName(newer)}`}>
            <T ns="patches" v={{ patch: patchName(newer) }}>
              {"Patch {patch}"}
            </T>{" "}
            →
          </Link>
        )}
      </p>
    </>
  );
}
