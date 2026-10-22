import type { Metadata } from "next";
import Link from "next/link";
import Intro from "@/components/Intro";
import { pageMeta } from "@/lib/meta";
import { recap, recapPatches } from "@/lib/patches";
import { Name, T } from "@/components/I18n";
import { patchName, patchVersion } from "@/lib/patch-name";
import { bySet } from "@/lib/sets";
import { livePatch } from "@/lib/highlights";
import { readRepoJson } from "@/lib/repo-data";
import { awaitingData, type PatchSchedule } from "@/lib/patch-schedule";

export const metadata: Metadata = pageMeta(
  "/patches",
  "ARAM Mayhem Patches",
  "Every ARAM Mayhem patch at a glance, grouped by set: augment changes and the champions that rose and fell most.",
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
                  <Link key={r.patch} className="card recap-row" href={`/patches/${patchName(r.patch)}`} data-accent={i === 0 ? "tier" : undefined}>
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
                        <T ns="patches" v={{ n: r.changed.length }}>
                          {"{n} augments changed"}
                        </T>
                      ) : (
                        <T ns="patches">Win rates only</T>
                      )}
                    </span>
                    {r.up[0] && (
                      <span className="recap-top">
                        <small className="recap-top-label">
                          <T ns="patches">Rose the most</T>
                        </small>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/icons/champions/${r.up[0].id}.webp`} alt="" width={22} height={22} loading="lazy" />
                        <Name kind="champions" id={r.up[0].id}>
                          {r.up[0].name}
                        </Name>{" "}
                        <span className="delta-up">
                          <T ns="patches" v={{ n: pts(r.up[0].change) }}>
                            {"{n} pts"}
                          </T>
                        </span>
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </>
  );
}
