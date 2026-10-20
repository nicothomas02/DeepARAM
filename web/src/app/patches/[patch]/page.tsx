import type { Metadata } from "next";
import { Breadcrumbs } from "@/components/JsonLd";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageMeta } from "@/lib/meta";
import { recap, recapPatches, type AugRef } from "@/lib/patches";
import { LocalDate, Name, T } from "@/components/I18n";
import { patchName, patchVersion } from "@/lib/patch-name";

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
    `What changed in ARAM Mayhem on patch ${patchName(r.patch)}: ${r.added.length} augments added, ${r.removed.length} removed, ${r.changed.length} changed.${top}`,
  );
}

function Aug({ a }: { a: AugRef }) {
  const body = (
    <>
      {a.icon ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="icon" src={`/icons/augments/${a.id}.webp`} alt="" width={24} height={24} loading="lazy" />
      ) : (
        <span className="icon" aria-hidden="true" />
      )}
      <span className="rank-name">
        <Name kind="augments" id={a.id}>
          {a.name}
        </Name>
      </span>
      {a.tier && (
        <span className={`chip tier-${a.tier}`}>
          <T ns="patches">{a.tier[0].toUpperCase() + a.tier.slice(1)}</T>
        </span>
      )}
    </>
  );
  return a.href ? (
    <Link href={a.href} data-tilt="soft" data-rarity={a.tier}>
      {body}
    </Link>
  ) : (
    <div>{body}</div>
  );
}

export default async function PatchPage({ params }: { params: Promise<{ patch: string }> }) {
  const r = recap(patchVersion((await params).patch));
  if (!r) notFound();
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
          <div>
            <b>{r.added.length}</b>
            <span>
              <T ns="patches">augments added</T>
            </span>
          </div>
          <div>
            <b>{r.removed.length}</b>
            <span>
              <T ns="patches">removed</T>
            </span>
          </div>
          <div>
            <b>{r.changed.length}</b>
            <span>
              <T ns="patches">changed</T>
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
                <Link key={c.id} href={`/champions/${c.id}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="icon" src={`/icons/champions/${c.id}.webp`} alt="" width={24} height={24} loading="lazy" />
                  <span className="rank-name">
                    <Name kind="champions" id={c.id}>
                      {c.name}
                    </Name>
                  </span>
                  <span className="rank-v">{pct(c.winRate)}</span>
                  <span className="rank-v delta-up">{pts(c.change)}</span>
                </Link>
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
                <Link key={c.id} href={`/champions/${c.id}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="icon" src={`/icons/champions/${c.id}.webp`} alt="" width={24} height={24} loading="lazy" />
                  <span className="rank-name">
                    <Name kind="champions" id={c.id}>
                      {c.name}
                    </Name>
                  </span>
                  <span className="rank-v">{pct(c.winRate)}</span>
                  <span className="rank-v delta-down">{pts(c.change)}</span>
                </Link>
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
                        {x.name}: <s>{x.old}</s> → <b>{x.new}</b>
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
            </div>
            <div className="rank plain recap-list">
              {r.added.map((a) => (
                <Aug key={a.id} a={a} />
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
