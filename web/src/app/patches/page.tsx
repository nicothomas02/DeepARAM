import type { Metadata } from "next";
import RowLink from "@/components/RowLink";
import Intro from "@/components/Intro";
import { pageMeta } from "@/lib/meta";
import { recap, recapPatches } from "@/lib/patches";
import { Name, T } from "@/components/I18n";
import { patchName, patchVersion } from "@/lib/patch-name";
import { bySet } from "@/lib/sets";
import { livePatch } from "@/lib/highlights";
import { readRepoJson } from "@/lib/repo-data";
import { awaitingData, type PatchSchedule } from "@/lib/patch-schedule";
import { scorecard } from "@/lib/scorecard";

export const metadata: Metadata = pageMeta(
  "/patches",
  "ARAM Mayhem Patches",
  "Every ARAM Mayhem patch at a glance, grouped by set: augments added, removed and changed, and the champions that rose and fell most.",
);

const pts = (v: number) => `${v > 0 ? "+" : ""}${(v * 100).toFixed(1)}`;

export default function PatchesPage() {
  const recaps = recapPatches()
    .map((p) => recap(p)!)
    .filter(Boolean);
  // A patch that is out but has no stats yet (the first days after patch day) is the live one: it gets the Live chip and
  // a row of its own instead of the newest patch with stats.
  const schedule = readRepoJson<PatchSchedule>("data/patch-schedule.json");
  const waiting = schedule ? awaitingData(schedule, livePatch()) : null;
  const pending = waiting ? patchVersion(waiting.patch) : null;
  const card = scorecard();
  const share = (v: number) => `${Math.round(v * 100)}%`;
  return (
    <>
      <Intro eyebrow={<T ns="patches">Patches</T>} title={<T ns="patches">What every patch changed.</T>}>
        <T ns="patches">Augment changes and the biggest champion risers and fallers, patch by patch.</T>
      </Intro>
      {bySet([...(pending ? [pending] : []), ...recaps.map((r) => r.patch)]).map(({ set, patches }) => {
        const group = recaps.filter((r) => patches.includes(r.patch));
        return (
          <section key={set.name} className="recap-set" aria-label={set.name}>
            <h2 className="recap-set-head">
              <T ns="patches">{set.name}</T>
              <small>{patches.length > 1 ? `${patchName(patches.at(-1))} – ${patchName(patches[0])}` : patchName(patches[0])}</small>
            </h2>
            <div className="recap-index">
              {pending && patches[0] === pending && (
                <div className="card recap-row" data-accent="tier">
                  <b className="recap-patch">
                    {patchName(pending)}
                    <span className="chip">
                      <T ns="patches">Live</T>
                    </span>
                  </b>
                  <span className="recap-meta">
                    <T ns="patch-countdown">New patch data takes a couple of days to collect.</T>
                  </span>
                </div>
              )}
              {group.map((r) => {
                const i = recaps.indexOf(r) + (pending ? 1 : 0);
                return (
                  <RowLink key={r.patch} className="card recap-row" href={`/patches/${patchName(r.patch)}`} data-accent={i === 0 ? "tier" : undefined}>
                    <b className="recap-patch">
                      {patchName(r.patch)}
                      {i === 0 && (
                        <span className="chip">
                          <T ns="patches">Live</T>
                        </span>
                      )}
                    </b>
                    <span className="recap-meta">
                      {r.hasAugmentHistory ? (
                        <>
                          {r.added.length > 0 && (
                            <>
                              <T ns="patches" v={{ n: r.added.length }}>
                                {"{n} added"}
                              </T>
                              {" · "}
                            </>
                          )}
                          {r.removed.length > 0 && (
                            <>
                              <T ns="patches" v={{ n: r.removed.length }}>
                                {"{n} removed"}
                              </T>
                              {" · "}
                            </>
                          )}
                          <T ns="patches" v={{ n: r.changed.length }}>
                            {"{n} augments changed"}
                          </T>
                        </>
                      ) : (
                        <T ns="patches">Win rates only</T>
                      )}
                    </span>
                    {(r.up[0] || r.down[0]) && (
                      // The biggest riser and, beside it, the biggest faller (site idea 2026-11-06).
                      <span className="recap-tops">
                        {[
                          { c: r.up[0], label: "Rose the most", cls: "delta-up" },
                          { c: r.down[0], label: "Fell the most", cls: "delta-down" },
                        ].map(({ c, label, cls }) =>
                          c ? (
                            <span key={label} className="recap-top">
                              <small className="recap-top-label">
                                <T ns="patches">{label}</T>
                              </small>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={`/icons/champions/${c.id}.webp`} alt="" width={22} height={22} loading="lazy" />
                              <Name kind="champions" id={c.id}>
                                {c.name}
                              </Name>{" "}
                              <span className={cls}>
                                <T ns="patches" v={{ n: pts(c.change) }}>
                                  {"{n} pts"}
                                </T>
                              </span>
                            </span>
                          ) : null,
                        )}
                      </span>
                    )}
                  </RowLink>
                );
              })}
            </div>
          </section>
        );
      })}
      {card.length > 0 && (
        <section className="recap-set" aria-label="How our picks held up">
          <h2 className="recap-set-head">
            <T ns="patches">How our picks held up</T>
          </h2>
          <p className="patch-note">
            <T ns="patches">
              Each patch, we take every champion&apos;s top 5 augments and top 3 items by DeepScore and check them on the next patch&apos;s games: how
              often they still beat the champion&apos;s average, and by how many points. The most picked ones are the baseline. Holding up is not
              proof an augment causes the wins.
            </T>
          </p>
          <div className="recap-index">
            {card.map((r) => (
              <div key={r.from} className="card recap-row">
                <b className="recap-patch">
                  {patchName(r.from)} → {patchName(r.to)}
                  {r.to_partial && (
                    <span className="chip">
                      <T ns="patches">So far</T>
                    </span>
                  )}
                </b>
                <span className="recap-meta">
                  {[
                    ["Augments", r.augments],
                    ["Items", r.items],
                  ].map(([label, s]) =>
                    s && typeof s === "object" ? (
                      <span key={label as string}>
                        <T ns="patches" v={{ hit: share(s.deepscore.hit), lead: pts(s.deepscore.lead), phit: share(s.popular.hit), plead: pts(s.popular.lead) }}>
                          {label === "Augments"
                            ? "Augments: {hit} still ahead ({lead} pts), most picked {phit} ({plead})"
                            : "Items: {hit} still ahead ({lead} pts), most bought {phit} ({plead})"}
                        </T>{" "}
                      </span>
                    ) : null,
                  )}
                  {r.champions && (
                    <span>
                      <T ns="patches" v={{ n: r.champions.n, kept: share(r.champions.still_above_50) }}>
                        {"Top {n} champions: {kept} still above 50%"}
                      </T>
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
